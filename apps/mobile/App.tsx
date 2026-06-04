import React, { useDeferredValue, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api-production-1d018.up.railway.app/api/v1";

const trades = [
  ["WATERPROOF", "방수"],
  ["TILE", "타일"],
  ["PAINT", "도장"],
  ["ELECTRIC", "전기"],
  ["MEP", "설비"],
  ["WINDOW", "창호"],
  ["CONCRETE", "콘크리트"],
  ["OTHER", "기타"]
] as const;

const surfaces = [
  ["FLOOR", "바닥"],
  ["WALL", "벽"],
  ["CEILING", "천장"],
  ["WINDOW", "창"],
  ["DOOR", "문"],
  ["PIPE", "배관"],
  ["ELECTRIC", "전기"],
  ["OTHER", "기타"]
] as const;

type AuthMode = "login" | "register";
type RegisterRole = "WORKER" | "COMPANY_ADMIN";
type SurfaceCode = (typeof surfaces)[number][0];
type TradeCode = (typeof trades)[number][0];
type RoomProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

type Project = {
  id: string;
  name: string;
  code: string;
  member_role?: string | null;
};

type Room = {
  id: string;
  bim_photo_room_id: string;
  room_name: string;
  room_number?: string | null;
  level_name?: string | null;
  progress_by_surface?: Partial<Record<SurfaceCode, { status: RoomProgressStatus; photo_count: number }>>;
};

type User = {
  email: string;
  name: string;
  role: string;
};

type AuthResponse = {
  data: {
    access_token: string;
    user: User;
  };
};

type UploadMeta = {
  work_surface: SurfaceCode;
  trade: TradeCode;
  work_date: string;
  worker_name: string;
  description: string;
};

type RoomSection = {
  title: string;
  data: Room[];
};

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [registerRole, setRegisterRole] = useState<RegisterRole>("WORKER");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("테스트회사");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [roomPickerVisible, setRoomPickerVisible] = useState(false);
  const [roomSearch, setRoomSearch] = useState("");
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [status, setStatus] = useState("로그인 후 프로젝트를 선택하면 현장 사진을 바로 올릴 수 있습니다.");
  const [authBusy, setAuthBusy] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [meta, setMeta] = useState<UploadMeta>({
    work_surface: "WALL",
    trade: "OTHER",
    work_date: todayValue(),
    worker_name: "",
    description: ""
  });

  const deferredRoomSearch = useDeferredValue(roomSearch);
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projectId, projects]);
  const selectedRoom = useMemo(() => rooms.find((room) => room.id === roomId) ?? null, [roomId, rooms]);
  const roomSections = useMemo(() => buildRoomSections(rooms, deferredRoomSearch), [deferredRoomSearch, rooms]);
  const isAuthenticated = Boolean(token && user);
  const isUploadStage = isAuthenticated && images.length > 0;
  const canCapture = Boolean(projectId) && !loadingRooms && !loadingProjects;
  const readyToUpload = Boolean(token && projectId && roomId && images.length > 0) && !uploading;
  const roomProgress = selectedRoom ? roomProgressLabel(selectedRoom, meta.work_surface) : "방을 선택하세요";
  const roomProgressTone = selectedRoom ? progressTone(selectedRoom, meta.work_surface) : "gray";

  async function authenticate() {
    if (!email.trim() || !password.trim()) {
      const message = "이메일과 비밀번호를 입력해 주세요.";
      setStatus(message);
      Alert.alert("입력 확인", message);
      return;
    }

    if (authMode === "register") {
      if (!name.trim()) {
        const message = "이름을 입력해 주세요.";
        setStatus(message);
        Alert.alert("입력 확인", message);
        return;
      }

      if (!companyName.trim()) {
        const message = "회사명을 입력해 주세요.";
        setStatus(message);
        Alert.alert("입력 확인", message);
        return;
      }

      if (password.length < 8) {
        const message = "비밀번호는 8자 이상으로 입력해 주세요.";
        setStatus(message);
        Alert.alert("입력 확인", message);
        return;
      }
    }

    setAuthBusy(true);
    try {
      const path = authMode === "login" ? "/auth/login" : "/auth/register";
      const body =
        authMode === "login"
          ? { email: email.trim(), password }
          : { email: email.trim(), password, name: name.trim(), company_name: companyName.trim(), role: registerRole };

      const json = await apiJson<AuthResponse>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      setToken(json.data.access_token);
      setUser(json.data.user);
      setPassword("");
      setMeta((current) => ({
        ...current,
        worker_name: json.data.user.name,
        work_date: todayValue()
      }));
      setStatus(`${json.data.user.name} 계정으로 로그인했습니다.`);
      await loadProjects(json.data.access_token);
    } catch (error) {
      const message = getErrorMessage(error, "로그인 처리 중 오류가 발생했습니다.");
      setStatus(message);
      Alert.alert("오류", message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function loadProjects(nextToken = token, preferredProjectId = projectId) {
    if (!nextToken) return;

    setLoadingProjects(true);
    try {
      const json = await apiJson<{ data: Project[] }>("/projects", { headers: authHeaders(nextToken) });
      const nextProjects = Array.isArray(json.data) ? json.data : [];
      const nextProjectId = nextProjects.some((project) => project.id === preferredProjectId) ? preferredProjectId : nextProjects[0]?.id ?? "";

      setProjects(nextProjects);
      setProjectId(nextProjectId);

      if (nextProjectId) {
        await loadRooms(nextToken, nextProjectId);
      } else {
        setRooms([]);
        setRoomId("");
        setStatus("참여 중인 프로젝트가 없습니다. 관리자에게 받은 접근키로 프로젝트에 참여해 주세요.");
      }
    } catch (error) {
      const message = getErrorMessage(error, "프로젝트 목록을 불러오지 못했습니다.");
      setProjects([]);
      setProjectId("");
      setRooms([]);
      setRoomId("");
      setStatus(message);
      throw error;
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId, preferredRoomId = roomId) {
    if (!nextToken) return;

    if (!nextProjectId) {
      setRooms([]);
      setRoomId("");
      setStatus("프로젝트를 먼저 선택해 주세요.");
      return;
    }

    setLoadingRooms(true);
    try {
      const json = await apiJson<{ data: Room[] }>(`/projects/${nextProjectId}/rooms`, {
        headers: authHeaders(nextToken)
      });
      const nextRooms = Array.isArray(json.data) ? json.data : [];
      const nextRoomId = nextRooms.some((room) => room.id === preferredRoomId) ? preferredRoomId : nextRooms[0]?.id ?? "";

      setRooms(nextRooms);
      setRoomId(nextRoomId);

      if (nextRooms.length === 0) {
        setStatus("선택한 프로젝트에 등록된 방이 없습니다.");
      } else {
        setStatus(`${nextRooms.length}개의 방을 불러왔습니다.`);
      }
    } catch (error) {
      const message = getErrorMessage(error, "방 목록을 불러오지 못했습니다.");
      setRooms([]);
      setRoomId("");
      setStatus(message);
      throw error;
    } finally {
      setLoadingRooms(false);
    }
  }

  async function previewJoinProject() {
    if (!token) return;

    const accessKey = joinKey.trim();
    if (!accessKey) {
      const message = "관리자가 공유한 프로젝트 접근키를 입력해 주세요.";
      setStatus(message);
      Alert.alert("입력 확인", message);
      return;
    }

    try {
      const json = await apiJson<{ data: Project }>("/projects/access-key/preview", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ access_key: accessKey })
      });

      Alert.alert("프로젝트 참여", `${json.data.name}\n이 프로젝트에 참여하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        {
          text: "참여하기",
          onPress: () => {
            void joinProject(accessKey);
          }
        }
      ]);
    } catch (error) {
      const message = getErrorMessage(error, "프로젝트 확인 중 오류가 발생했습니다.");
      setStatus(message);
      Alert.alert("오류", message);
    }
  }

  async function joinProject(accessKey = joinKey.trim()) {
    if (!token) return;

    try {
      const json = await apiJson<{ data: Project }>("/projects/join", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ access_key: accessKey })
      });

      setJoinKey("");
      setStatus(`${json.data.name} 프로젝트에 참여했습니다.`);
      await loadProjects(token, json.data.id);
    } catch (error) {
      const message = getErrorMessage(error, "프로젝트 참여 중 오류가 발생했습니다.");
      setStatus(message);
      Alert.alert("오류", message);
    }
  }

  async function selectProject(nextProjectId: string) {
    if (!token || nextProjectId === projectId) return;

    setProjectId(nextProjectId);
    setRoomSearch("");
    setRoomPickerVisible(false);
    try {
      await loadRooms(token, nextProjectId);
    } catch (error) {
      const message = getErrorMessage(error, "방 목록을 다시 불러오지 못했습니다.");
      Alert.alert("오류", message);
    }
  }

  async function takePhoto() {
    if (!projectId) {
      const message = "사진 촬영 전에 프로젝트를 먼저 선택해 주세요.";
      setStatus(message);
      Alert.alert("프로젝트 선택", message);
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("카메라 권한 필요", "현장 촬영을 위해 카메라 권한을 허용해 주세요.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85
    });

    if (result.canceled) return;

    setImages((current) => [...current, ...result.assets]);
    setStatus(`${result.assets.length}장의 사진을 초안에 담았습니다.`);
  }

  async function pickImages() {
    if (!projectId) {
      const message = "사진 선택 전에 프로젝트를 먼저 선택해 주세요.";
      setStatus(message);
      Alert.alert("프로젝트 선택", message);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("앨범 권한 필요", "사진 선택을 위해 앨범 권한을 허용해 주세요.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85
    });

    if (result.canceled) return;

    setImages((current) => [...current, ...result.assets]);
    setStatus(`${result.assets.length}장의 사진을 초안에 담았습니다.`);
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, imageIndex) => imageIndex !== index));
  }

  function clearDraft() {
    Alert.alert("초안 비우기", "선택한 사진과 입력한 메모를 지우시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "비우기",
        style: "destructive",
        onPress: () => {
          setImages([]);
          setMeta((current) => ({
            ...current,
            description: "",
            work_date: todayValue()
          }));
          setStatus("업로드 초안을 비웠습니다.");
        }
      }
    ]);
  }

  async function upload() {
    if (!token || !projectId || !roomId || images.length === 0) {
      Alert.alert("업로드 준비 필요", "프로젝트, 방, 사진을 모두 선택한 뒤 다시 시도해 주세요.");
      return;
    }

    setUploading(true);
    try {
      for (const image of images) {
        const mime = image.mimeType ?? "image/jpeg";
        const fileResponse = await fetch(image.uri);
        const blob = await fileResponse.blob();
        const presign = await apiJson<{ data: { upload_id: string; presigned_url: string } }>("/uploads/photos/presign", {
          method: "POST",
          headers: { ...authHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, mime_type: mime, file_size: blob.size })
        });

        const putResponse = await fetch(presign.data.presigned_url, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: blob
        });

        if (!putResponse.ok) {
          throw new Error(`파일 업로드 실패: ${putResponse.status}`);
        }

        await apiJson("/photos", {
          method: "POST",
          headers: { ...authHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            room_id: roomId,
            upload_id: presign.data.upload_id,
            ...meta
          })
        });
      }

      setImages([]);
      setMeta((current) => ({
        ...current,
        worker_name: user?.name ?? current.worker_name,
        work_date: todayValue(),
        description: ""
      }));
      setStatus("사진 업로드가 완료되었고 AI 분석 대기열에 등록되었습니다.");
      Alert.alert("업로드 완료", "선택한 방에 사진이 연결되었습니다.");
      await loadRooms(token, projectId, roomId);
    } catch (error) {
      const message = getErrorMessage(error, "사진 업로드 중 오류가 발생했습니다.");
      setStatus(message);
      Alert.alert("오류", message);
    } finally {
      setUploading(false);
    }
  }

  function logout() {
    setToken("");
    setUser(null);
    setProjects([]);
    setProjectId("");
    setJoinKey("");
    setRooms([]);
    setRoomId("");
    setImages([]);
    setRoomSearch("");
    setRoomPickerVisible(false);
    setEmail("");
    setPassword("");
    setStatus("로그아웃했습니다.");
    setMeta({
      work_surface: "WALL",
      trade: "OTHER",
      work_date: todayValue(),
      worker_name: "",
      description: ""
    });
  }

  function openRoomPicker() {
    if (!projectId) {
      Alert.alert("프로젝트 선택", "방을 고르기 전에 프로젝트를 먼저 선택해 주세요.");
      return;
    }

    setRoomSearch("");
    setRoomPickerVisible(true);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.screenContainer} keyboardShouldPersistTaps="handled">
        {!isAuthenticated ? (
          <View style={styles.authLayout}>
            <View style={styles.brandBlock}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>B</Text>
              </View>
              <Text style={styles.brandTitle}>BIM Photo Sync</Text>
              <Text style={styles.brandSubtitle}>작업자를 위한 현장 사진 업로드 전용 모바일 흐름</Text>
            </View>

            <View style={styles.authCard}>
              <View style={styles.segmented}>
                <Pressable style={[styles.segment, authMode === "login" && styles.segmentActive]} onPress={() => setAuthMode("login")}>
                  <Text style={[styles.segmentText, authMode === "login" && styles.segmentTextActive]}>로그인</Text>
                </Pressable>
                <Pressable style={[styles.segment, authMode === "register" && styles.segmentActive]} onPress={() => setAuthMode("register")}>
                  <Text style={[styles.segmentText, authMode === "register" && styles.segmentTextActive]}>회원가입</Text>
                </Pressable>
              </View>

              <Text style={styles.sectionTitle}>{authMode === "login" ? "이메일로 로그인" : "작업자 계정 등록"}</Text>
              <Text style={styles.cardDescription}>Google, Apple 없이 기존 서비스 이메일/비밀번호 인증만 사용합니다.</Text>

              {authMode === "register" ? (
                <View style={styles.roleRow}>
                  <RoleButton label="작업자" active={registerRole === "WORKER"} onPress={() => setRegisterRole("WORKER")} />
                  <RoleButton label="회사 관리자" active={registerRole === "COMPANY_ADMIN"} onPress={() => setRegisterRole("COMPANY_ADMIN")} />
                </View>
              ) : null}

              <Input
                label="이메일"
                value={email}
                onChangeText={setEmail}
                placeholder="example@company.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <Input
                label="비밀번호"
                value={password}
                onChangeText={setPassword}
                placeholder="비밀번호 입력"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />

              {authMode === "register" ? (
                <>
                  <Input label="이름" value={name} onChangeText={setName} placeholder="예: 최반장" />
                  <Input label="회사명" value={companyName} onChangeText={setCompanyName} placeholder="예: 한빛건설" />
                </>
              ) : null}

              <Pressable style={[styles.primaryAction, authBusy && styles.disabledButton]} disabled={authBusy} onPress={() => void authenticate()}>
                {authBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryActionText}>{authMode === "login" ? "로그인" : "계정 만들기"}</Text>}
              </Pressable>
            </View>
          </View>
        ) : null}

        {isAuthenticated && !isUploadStage ? (
          <View style={styles.homeLayout}>
            <View style={styles.topBar}>
              <View>
                <Text style={styles.topBarLabel}>{roleLabel(user?.role ?? "WORKER")} · {user?.email}</Text>
                <Text style={styles.topBarValue}>{user?.name}</Text>
              </View>
              <Pressable style={styles.ghostButton} onPress={logout}>
                <Text style={styles.ghostButtonText}>로그아웃</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>프로젝트 선택</Text>
                  <Text style={styles.cardDescription}>촬영 전에 업로드할 프로젝트를 먼저 고릅니다.</Text>
                </View>
                {loadingProjects ? <ActivityIndicator color="#0F172A" /> : null}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.projectRow}>
                {projects.map((project) => (
                  <Pressable
                    key={project.id}
                    style={[styles.projectChip, project.id === projectId && styles.projectChipActive]}
                    onPress={() => void selectProject(project.id)}
                  >
                    <Text style={[styles.projectName, project.id === projectId && styles.projectNameActive]}>{project.name}</Text>
                    <Text style={styles.projectCode}>{project.code}</Text>
                  </Pressable>
                ))}

                {projects.length === 0 && !loadingProjects ? (
                  <View style={styles.emptyPill}>
                    <Text style={styles.emptyPillText}>참여 중인 프로젝트가 없습니다.</Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>

            <View style={styles.captureCard}>
              <Text style={styles.captureEyebrow}>작업자 촬영 홈</Text>
              <Text style={styles.captureTitle}>{selectedProject ? selectedProject.name : "프로젝트를 선택해 주세요"}</Text>
              <Text style={styles.captureDescription}>
                {selectedProject ? "중앙 버튼으로 바로 촬영하고, 앨범 선택도 같은 흐름으로 업로드 초안을 만듭니다." : "프로젝트를 고르면 촬영 버튼이 활성화됩니다."}
              </Text>

              <Pressable style={[styles.cameraButton, !canCapture && styles.disabledButton]} disabled={!canCapture} onPress={() => void takePhoto()}>
                <Text style={styles.cameraButtonSub}>CAMERA</Text>
                <Text style={styles.cameraButtonText}>촬영</Text>
              </Pressable>

              <Pressable style={[styles.secondaryAction, !canCapture && styles.disabledButton]} disabled={!canCapture} onPress={() => void pickImages()}>
                <Text style={styles.secondaryActionText}>앨범에서 선택</Text>
              </Pressable>

              <View style={styles.infoRow}>
                <StatusPill label={selectedProject ? "프로젝트 준비 완료" : "프로젝트 선택 필요"} tone={selectedProject ? "blue" : "gray"} />
                <StatusPill label={loadingRooms ? "방 불러오는 중" : `${rooms.length}개 방`} tone={rooms.length > 0 ? "green" : "gray"} />
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>프로젝트 접근키로 참여</Text>
              <Text style={styles.cardDescription}>작업자 계정을 만든 뒤 받은 접근키로 프로젝트에 바로 합류할 수 있습니다.</Text>
              <Input
                label="프로젝트 접근키"
                value={joinKey}
                onChangeText={setJoinKey}
                placeholder="접근키 입력"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable style={styles.secondaryActionWide} onPress={() => void previewJoinProject()}>
                <Text style={styles.secondaryActionText}>프로젝트 확인 후 참여</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {isAuthenticated && isUploadStage ? (
          <View style={styles.uploadLayout}>
            <View style={styles.topBar}>
              <View>
                <Text style={styles.topBarLabel}>업로드 초안</Text>
                <Text style={styles.topBarValue}>{selectedProject?.name ?? "프로젝트 없음"}</Text>
              </View>
              <Pressable style={styles.ghostButton} onPress={clearDraft}>
                <Text style={styles.ghostButtonText}>초안 비우기</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>사진 미리보기</Text>
              <Text style={styles.cardDescription}>촬영 또는 선택한 사진을 확인하고 필요 없는 사진은 바로 지울 수 있습니다.</Text>

              <Image source={{ uri: images[0]?.uri }} style={styles.heroPreview} />

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
                {images.map((image, index) => (
                  <View key={`${image.uri}-${index}`} style={styles.thumbnailCard}>
                    <Image source={{ uri: image.uri }} style={styles.thumbnailImage} />
                    <Pressable style={styles.thumbnailRemoveButton} onPress={() => removeImage(index)}>
                      <Text style={styles.thumbnailRemoveText}>삭제</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.quickActionRow}>
                <Pressable style={styles.secondaryActionInline} onPress={() => void takePhoto()}>
                  <Text style={styles.secondaryActionText}>사진 추가 촬영</Text>
                </Pressable>
                <Pressable style={styles.secondaryActionInline} onPress={() => void pickImages()}>
                  <Text style={styles.secondaryActionText}>앨범에서 더 선택</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>방 선택</Text>
              <Text style={styles.cardDescription}>층별로 묶인 목록에서 검색해 정확한 방을 선택합니다.</Text>

              <Pressable style={styles.roomSelector} onPress={openRoomPicker}>
                <View style={styles.roomSelectorText}>
                  <Text style={styles.roomSelectorLabel}>선택한 방</Text>
                  <Text style={styles.roomSelectorValue}>{selectedRoom ? roomTitle(selectedRoom) : "방을 선택하세요"}</Text>
                  <Text style={styles.roomSelectorMeta}>{selectedRoom ? `${selectedRoom.level_name ?? "층 정보 없음"} · ${roomProgress}` : "탭해서 방 목록 열기"}</Text>
                </View>
                <StatusPill label={roomProgress} tone={roomProgressTone} />
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>업로드 정보</Text>
              <Selector
                label="공사면"
                value={meta.work_surface}
                values={surfaces}
                onChange={(work_surface) => setMeta((current) => ({ ...current, work_surface: work_surface as SurfaceCode }))}
              />
              <Selector
                label="공종"
                value={meta.trade}
                values={trades}
                onChange={(trade) => setMeta((current) => ({ ...current, trade: trade as TradeCode }))}
              />
              <Input label="작업일자" value={meta.work_date} onChangeText={(work_date) => setMeta((current) => ({ ...current, work_date }))} placeholder="YYYY-MM-DD" />
              <Input label="작성자" value={meta.worker_name} onChangeText={(worker_name) => setMeta((current) => ({ ...current, worker_name }))} placeholder="예: 최반장" />
              <Input
                label="작업 메모"
                value={meta.description}
                onChangeText={(description) => setMeta((current) => ({ ...current, description }))}
                placeholder="작업 상태나 특이사항을 남겨 주세요."
                multiline
              />
            </View>

            <View style={styles.card}>
              <View style={styles.infoRow}>
                <StatusPill label={`${images.length}장 선택`} tone={images.length > 0 ? "blue" : "gray"} />
                <StatusPill label={selectedRoom ? roomProgress : "방 선택 필요"} tone={selectedRoom ? roomProgressTone : "gray"} />
              </View>

              <Pressable style={[styles.uploadButton, !readyToUpload && styles.disabledButton]} disabled={!readyToUpload} onPress={() => void upload()}>
                {uploading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryActionText}>선택한 방에 업로드</Text>}
              </Pressable>
            </View>
          </View>
        ) : null}

        {status ? <Text style={styles.statusBanner}>{status}</Text> : null}
      </ScrollView>

      <Modal visible={roomPickerVisible} transparent animationType="slide" onRequestClose={() => setRoomPickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalDismissArea} onPress={() => setRoomPickerVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>방 선택</Text>
                <Text style={styles.sheetSubtitle}>{selectedProject?.name ?? "프로젝트 없음"}</Text>
              </View>
              {loadingRooms ? <ActivityIndicator color="#0F172A" /> : null}
            </View>

            <TextInput
              style={styles.searchInput}
              placeholder="층, 방 번호, 방 이름으로 검색"
              placeholderTextColor="#94A3B8"
              value={roomSearch}
              onChangeText={setRoomSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <SectionList
              sections={roomSections}
              keyExtractor={(item) => item.id}
              stickySectionHeadersEnabled={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.sectionListContent}
              renderSectionHeader={({ section }) => <Text style={styles.sectionHeaderText}>{section.title}</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.roomRow, item.id === roomId && styles.roomRowActive]}
                  onPress={() => {
                    setRoomId(item.id);
                    setRoomPickerVisible(false);
                    setStatus(`${roomTitle(item)} 방을 선택했습니다.`);
                  }}
                >
                  <View style={styles.roomRowText}>
                    <Text style={styles.roomRowTitle}>{roomTitle(item)}</Text>
                    <Text style={styles.roomRowMeta}>{item.level_name ?? "층 정보 없음"} · {roomProgressLabel(item, meta.work_surface)}</Text>
                  </View>
                  <StatusPill label={`${surfacePhotoCount(item, meta.work_surface)}장`} tone={progressTone(item, meta.work_surface)} />
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.emptySheetState}>
                  <Text style={styles.emptySheetTitle}>검색 결과가 없습니다.</Text>
                  <Text style={styles.emptySheetBody}>검색어를 바꾸거나 프로젝트 방 목록을 다시 불러와 보세요.</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function RoleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.roleButton, active && styles.roleButtonActive]} onPress={onPress}>
      <Text style={[styles.roleButtonText, active && styles.roleButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Input({
  label,
  placeholder,
  multiline,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
} & Pick<TextInputProps, "autoCapitalize" | "autoCorrect" | "keyboardType" | "secureTextEntry">) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textarea]}
        placeholder={placeholder ?? label}
        placeholderTextColor="#94A3B8"
        multiline={multiline}
        {...props}
      />
    </View>
  );
}

function Selector(props: {
  label: string;
  value: string;
  values: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.selectorGrid}>
        {props.values.map(([value, label]) => (
          <Pressable key={value} style={[styles.selectorChip, props.value === value && styles.selectorChipActive]} onPress={() => props.onChange(value)}>
            <Text style={[styles.selectorChipText, props.value === value && styles.selectorChipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "blue" | "green" | "yellow" | "red" | "gray" }) {
  return (
    <View style={[styles.statusPill, styles[`pill${capitalize(tone)}`]]}>
      <Text style={[styles.statusPillText, tone === "gray" && styles.statusPillTextMuted]}>{label}</Text>
    </View>
  );
}

function buildRoomSections(rooms: Room[], rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  const filteredRooms = query ? rooms.filter((room) => roomSearchText(room).includes(query)) : rooms;
  const grouped = new Map<string, Room[]>();

  for (const room of filteredRooms) {
    const level = room.level_name?.trim() || "층 정보 없음";
    const existing = grouped.get(level);
    if (existing) existing.push(room);
    else grouped.set(level, [room]);
  }

  return Array.from(grouped.entries()).map<RoomSection>(([title, data]) => ({ title, data }));
}

function roomSearchText(room: Room) {
  return `${room.level_name ?? ""} ${room.room_number ?? ""} ${room.room_name} ${room.bim_photo_room_id}`.toLowerCase();
}

function roleLabel(role: string) {
  if (role === "SUPER_ADMIN") return "최고관리자";
  if (role === "COMPANY_ADMIN") return "회사 관리자";
  if (role === "PROJECT_ADMIN") return "프로젝트 관리자";
  if (role === "BIM_MANAGER") return "BIM 관리자";
  if (role === "MANAGER") return "관리자";
  if (role === "VIEWER") return "조회자";
  return "현장 작업자";
}

function roomTitle(room: Room) {
  return `${room.room_number ?? ""} ${room.room_name}`.trim();
}

function roomProgressLabel(room: Room, surface: SurfaceCode) {
  const progress = room.progress_by_surface?.[surface];
  if (progress?.status === "COMPLETED") return "완료";
  if (progress?.status === "IN_PROGRESS") return "진행 중";
  return "시작 전";
}

function progressTone(room: Room, surface: SurfaceCode): "green" | "yellow" | "red" | "gray" {
  const progress = room.progress_by_surface?.[surface];
  if (!progress) return "gray";
  if (progress.status === "COMPLETED") return "green";
  if (progress.status === "IN_PROGRESS") return "yellow";
  return "red";
}

function surfacePhotoCount(room: Room, surface: SurfaceCode) {
  return room.progress_by_surface?.[surface]?.photo_count ?? 0;
}

function authHeaders(nextToken: string) {
  return { Authorization: `Bearer ${nextToken}` };
}

async function apiJson<T>(path: string, options: RequestInit = {}) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
  }

  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
    const message = getApiErrorMessage(json) ?? `API 오류 ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}

function getApiErrorMessage(value: unknown) {
  if (!isRecord(value)) return null;
  const error = value.error;
  if (isRecord(error)) {
    const message = error.message;
    if (Array.isArray(message)) return message.map(String).join(", ");
    if (typeof message === "string") return message;
  }
  const message = value.message;
  if (Array.isArray(message)) return message.map(String).join(", ");
  if (typeof message === "string") return message;
  return null;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function capitalize(value: "blue" | "green" | "yellow" | "red" | "gray") {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` as "Blue" | "Green" | "Yellow" | "Red" | "Gray";
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#EEF3F8"
  },
  screenContainer: {
    paddingHorizontal: 16,
    paddingBottom: 28
  },
  authLayout: {
    minHeight: "100%",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 18
  },
  brandBlock: {
    borderRadius: 28,
    padding: 24,
    backgroundColor: "#0F172A",
    gap: 10
  },
  brandMark: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#38BDF8"
  },
  brandMarkText: {
    color: "#082F49",
    fontSize: 24,
    fontWeight: "900"
  },
  brandTitle: {
    color: "#F8FAFC",
    fontSize: 28,
    fontWeight: "900"
  },
  brandSubtitle: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 21
  },
  authCard: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 20,
    gap: 8
  },
  homeLayout: {
    paddingTop: 10,
    gap: 14
  },
  uploadLayout: {
    paddingTop: 10,
    gap: 14
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  topBarLabel: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700"
  },
  topBarValue: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "900"
  },
  ghostButton: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF"
  },
  ghostButtonText: {
    color: "#334155",
    fontWeight: "800"
  },
  card: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 18,
    gap: 8
  },
  captureCard: {
    borderRadius: 34,
    backgroundColor: "#082F49",
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: "center",
    gap: 12
  },
  captureEyebrow: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1
  },
  captureTitle: {
    color: "#F8FAFC",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    textAlign: "center"
  },
  captureDescription: {
    color: "#CFFAFE",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center"
  },
  cameraButton: {
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  cameraButtonSub: {
    color: "#0EA5E9",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.3
  },
  cameraButtonText: {
    color: "#082F49",
    fontSize: 30,
    fontWeight: "900"
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "900"
  },
  cardDescription: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 19
  },
  segmented: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC"
  },
  segmentActive: {
    borderColor: "#0EA5E9",
    backgroundColor: "#E0F2FE"
  },
  segmentText: {
    color: "#475569",
    fontWeight: "800"
  },
  segmentTextActive: {
    color: "#0369A1"
  },
  roleRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2
  },
  roleButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC"
  },
  roleButtonActive: {
    borderColor: "#0EA5E9",
    backgroundColor: "#E0F2FE"
  },
  roleButtonText: {
    color: "#334155",
    fontWeight: "800"
  },
  roleButtonTextActive: {
    color: "#0369A1"
  },
  field: {
    gap: 6,
    marginTop: 4
  },
  label: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "800"
  },
  input: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 14,
    color: "#0F172A",
    backgroundColor: "#FFFFFF"
  },
  textarea: {
    minHeight: 112,
    paddingTop: 14,
    textAlignVertical: "top"
  },
  primaryAction: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0284C7",
    marginTop: 10
  },
  primaryActionText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900"
  },
  secondaryAction: {
    minHeight: 50,
    minWidth: 210,
    borderRadius: 999,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#7DD3FC",
    backgroundColor: "#F8FAFC"
  },
  secondaryActionWide: {
    minHeight: 50,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#0EA5E9",
    backgroundColor: "#F8FAFC",
    marginTop: 10
  },
  secondaryActionInline: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC"
  },
  secondaryActionText: {
    color: "#0369A1",
    fontWeight: "900"
  },
  uploadButton: {
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16A34A",
    marginTop: 8
  },
  disabledButton: {
    opacity: 0.5
  },
  projectRow: {
    gap: 10,
    paddingVertical: 4
  },
  projectChip: {
    width: 180,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    padding: 14,
    gap: 4,
    backgroundColor: "#F8FAFC"
  },
  projectChipActive: {
    borderColor: "#0EA5E9",
    backgroundColor: "#E0F2FE"
  },
  projectName: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900"
  },
  projectNameActive: {
    color: "#0369A1"
  },
  projectCode: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700"
  },
  emptyPill: {
    minHeight: 60,
    borderRadius: 20,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC"
  },
  emptyPillText: {
    color: "#64748B",
    fontWeight: "700"
  },
  infoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  statusPill: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  statusPillText: {
    color: "#0F172A",
    fontSize: 12,
    fontWeight: "900"
  },
  statusPillTextMuted: {
    color: "#475569"
  },
  pillBlue: {
    backgroundColor: "#DBEAFE"
  },
  pillGreen: {
    backgroundColor: "#DCFCE7"
  },
  pillYellow: {
    backgroundColor: "#FEF3C7"
  },
  pillRed: {
    backgroundColor: "#FEE2E2"
  },
  pillGray: {
    backgroundColor: "#E2E8F0"
  },
  heroPreview: {
    width: "100%",
    height: 240,
    borderRadius: 22,
    backgroundColor: "#E2E8F0"
  },
  thumbnailRow: {
    gap: 10,
    paddingVertical: 4
  },
  thumbnailCard: {
    width: 110,
    gap: 6
  },
  thumbnailImage: {
    width: 110,
    height: 110,
    borderRadius: 18,
    backgroundColor: "#E2E8F0"
  },
  thumbnailRemoveButton: {
    minHeight: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2"
  },
  thumbnailRemoveText: {
    color: "#B91C1C",
    fontSize: 12,
    fontWeight: "900"
  },
  quickActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2
  },
  roomSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    padding: 16,
    backgroundColor: "#F8FAFC"
  },
  roomSelectorText: {
    flex: 1,
    gap: 3
  },
  roomSelectorLabel: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800"
  },
  roomSelectorValue: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "900"
  },
  roomSelectorMeta: {
    color: "#64748B",
    fontSize: 12,
    lineHeight: 18
  },
  selectorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  selectorChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#F8FAFC"
  },
  selectorChipActive: {
    borderColor: "#0EA5E9",
    backgroundColor: "#E0F2FE"
  },
  selectorChipText: {
    color: "#334155",
    fontWeight: "800"
  },
  selectorChipTextActive: {
    color: "#0369A1"
  },
  statusBanner: {
    marginTop: 14,
    marginBottom: 8,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    color: "#475569",
    fontSize: 13,
    lineHeight: 19
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.32)"
  },
  modalDismissArea: {
    flex: 1
  },
  sheet: {
    minHeight: "72%",
    maxHeight: "86%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#CBD5E1",
    marginBottom: 12
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12
  },
  sheetTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "900"
  },
  sheetSubtitle: {
    color: "#64748B",
    fontSize: 13
  },
  searchInput: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 14,
    color: "#0F172A",
    backgroundColor: "#F8FAFC",
    marginBottom: 10
  },
  sectionListContent: {
    paddingBottom: 10
  },
  sectionHeaderText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    paddingTop: 12,
    paddingBottom: 6
  },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    marginBottom: 8,
    backgroundColor: "#FFFFFF"
  },
  roomRowActive: {
    borderColor: "#0EA5E9",
    backgroundColor: "#E0F2FE"
  },
  roomRowText: {
    flex: 1,
    gap: 2
  },
  roomRowTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "900"
  },
  roomRowMeta: {
    color: "#64748B",
    fontSize: 12,
    lineHeight: 18
  },
  emptySheetState: {
    paddingVertical: 24,
    alignItems: "center",
    gap: 6
  },
  emptySheetTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900"
  },
  emptySheetBody: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center"
  }
});
