import React, { useDeferredValue, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
type PillTone = "blue" | "green" | "yellow" | "red" | "gray";

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
  const [companyName, setCompanyName] = useState("");
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
  const [status, setStatus] = useState("로그인 후 프로젝트를 선택하고 방 기준으로 현장 사진을 업로드하세요.");
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
  const roomProgress = selectedRoom ? roomProgressLabel(selectedRoom, meta.work_surface) : "방 선택 필요";
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
        const message = "비밀번호는 8자 이상이어야 합니다.";
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
      const message = getErrorMessage(error, "로그인에 실패했습니다.");
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
        setStatus("참여한 프로젝트가 없습니다. 관리자에게 받은 접근키를 입력하세요.");
      }
    } catch (error) {
      const message = getErrorMessage(error, "프로젝트를 불러오지 못했습니다.");
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
      setStatus("먼저 프로젝트를 선택하세요.");
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
      setStatus(nextRooms.length === 0 ? "이 프로젝트에 등록된 방이 없습니다." : `${nextRooms.length}개 방을 불러왔습니다.`);
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
      const message = "프로젝트 접근키를 입력해 주세요.";
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

      Alert.alert("프로젝트 참여", `${json.data.name} 프로젝트에 참여할까요?`, [
        { text: "취소", style: "cancel" },
        {
          text: "참여",
          onPress: () => {
            void joinProject(accessKey);
          }
        }
      ]);
    } catch (error) {
      const message = getErrorMessage(error, "프로젝트 정보를 확인하지 못했습니다.");
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
      const message = getErrorMessage(error, "프로젝트 참여에 실패했습니다.");
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
      const message = getErrorMessage(error, "방 목록을 새로고침하지 못했습니다.");
      Alert.alert("오류", message);
    }
  }

  async function takePhoto() {
    if (!projectId) {
      const message = "사진 촬영 전에 프로젝트를 선택하세요.";
      setStatus(message);
      Alert.alert("프로젝트 선택", message);
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("카메라 권한 필요", "현장 사진을 촬영할 수 있도록 카메라 접근을 허용해 주세요.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85
    });

    if (result.canceled) return;

    setImages((current) => [...current, ...result.assets]);
    setStatus(`${result.assets.length}장 사진을 업로드 초안에 추가했습니다.`);
  }

  async function pickImages() {
    if (!projectId) {
      const message = "사진 선택 전에 프로젝트를 선택하세요.";
      setStatus(message);
      Alert.alert("프로젝트 선택", message);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("사진 접근 권한 필요", "현장 사진을 선택할 수 있도록 사진 접근을 허용해 주세요.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85
    });

    if (result.canceled) return;

    setImages((current) => [...current, ...result.assets]);
    setStatus(`${result.assets.length}장 사진을 업로드 초안에 추가했습니다.`);
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, imageIndex) => imageIndex !== index));
  }

  function clearDraft() {
    Alert.alert("초안 비우기", "선택한 사진과 입력 내용을 지울까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "지우기",
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
      Alert.alert("업로드 준비 필요", "업로드 전에 프로젝트, 방, 사진을 선택하세요.");
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
          throw new Error(`파일 업로드에 실패했습니다: ${putResponse.status}`);
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
      const message = getErrorMessage(error, "사진 업로드에 실패했습니다.");
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
      Alert.alert("프로젝트 선택", "방을 선택하기 전에 프로젝트를 선택하세요.");
      return;
    }

    setRoomSearch("");
    setRoomPickerVisible(true);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.keyboardRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.screenContainer}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {!isAuthenticated ? (
            <AuthScreen
              authBusy={authBusy}
              authMode={authMode}
              companyName={companyName}
              email={email}
              name={name}
              password={password}
              registerRole={registerRole}
              setAuthMode={setAuthMode}
              setCompanyName={setCompanyName}
              setEmail={setEmail}
              setName={setName}
              setPassword={setPassword}
              setRegisterRole={setRegisterRole}
              submit={authenticate}
            />
          ) : null}

          {isAuthenticated && !isUploadStage ? (
            <HomeScreen
              canCapture={canCapture}
              joinKey={joinKey}
              loadingProjects={loadingProjects}
              loadingRooms={loadingRooms}
              logout={logout}
              pickImages={pickImages}
              previewJoinProject={previewJoinProject}
              projects={projects}
              projectId={projectId}
              rooms={rooms}
              selectedProject={selectedProject}
              selectProject={selectProject}
              setJoinKey={setJoinKey}
              takePhoto={takePhoto}
              user={user}
            />
          ) : null}

          {isAuthenticated && isUploadStage ? (
            <UploadScreen
              clearDraft={clearDraft}
              images={images}
              meta={meta}
              openRoomPicker={openRoomPicker}
              pickImages={pickImages}
              readyToUpload={readyToUpload}
              removeImage={removeImage}
              roomProgress={roomProgress}
              roomProgressTone={roomProgressTone}
              selectedProject={selectedProject}
              selectedRoom={selectedRoom}
              setMeta={setMeta}
              takePhoto={takePhoto}
              upload={upload}
              uploading={uploading}
            />
          ) : null}

          {status ? <Text style={styles.statusBanner}>{status}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <RoomPickerModal
        loadingRooms={loadingRooms}
        meta={meta}
        roomId={roomId}
        roomSearch={roomSearch}
        roomSections={roomSections}
        selectedProject={selectedProject}
        setRoomId={setRoomId}
        setRoomPickerVisible={setRoomPickerVisible}
        setRoomSearch={setRoomSearch}
        setStatus={setStatus}
        visible={roomPickerVisible}
      />
    </SafeAreaView>
  );
}

function AuthScreen(props: {
  authBusy: boolean;
  authMode: AuthMode;
  companyName: string;
  email: string;
  name: string;
  password: string;
  registerRole: RegisterRole;
  setAuthMode: (value: AuthMode) => void;
  setCompanyName: (value: string) => void;
  setEmail: (value: string) => void;
  setName: (value: string) => void;
  setPassword: (value: string) => void;
  setRegisterRole: (value: RegisterRole) => void;
  submit: () => Promise<void>;
}) {
  return (
    <View style={styles.authLayout}>
      <View style={styles.heroPanel}>
        <BimCameraHero />
        <View style={styles.heroCopy}>
          <Text style={styles.heroKicker}>BIM Photo Sync</Text>
          <Text style={styles.heroTitle}>현장 사진을 방 기준으로 빠르게 기록</Text>
          <Text style={styles.heroBody}>서비스 계정으로 로그인한 뒤 프로젝트, 층, 방, 공사면 기준으로 공정 사진을 업로드합니다.</Text>
        </View>
      </View>

      <View style={styles.authCard}>
        <View style={styles.segmented}>
          <Pressable style={[styles.segment, props.authMode === "login" && styles.segmentActive]} onPress={() => props.setAuthMode("login")}>
            <Text style={[styles.segmentText, props.authMode === "login" && styles.segmentTextActive]}>로그인</Text>
          </Pressable>
          <Pressable style={[styles.segment, props.authMode === "register" && styles.segmentActive]} onPress={() => props.setAuthMode("register")}>
            <Text style={[styles.segmentText, props.authMode === "register" && styles.segmentTextActive]}>회원가입</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{props.authMode === "login" ? "서비스 로그인" : "서비스 계정 생성"}</Text>
        <Text style={styles.cardDescription}>외부 로그인 없이 BIM Photo Sync 계정으로 로그인합니다.</Text>

        {props.authMode === "register" ? (
          <View style={styles.roleRow}>
            <RoleButton label="현장 작업자" active={props.registerRole === "WORKER"} onPress={() => props.setRegisterRole("WORKER")} />
            <RoleButton label="회사 관리자" active={props.registerRole === "COMPANY_ADMIN"} onPress={() => props.setRegisterRole("COMPANY_ADMIN")} />
          </View>
        ) : null}

        <Input
          label="이메일"
          value={props.email}
          onChangeText={props.setEmail}
          placeholder="example@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <Input
          label="비밀번호"
          value={props.password}
          onChangeText={props.setPassword}
          placeholder="비밀번호를 입력하세요"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {props.authMode === "register" ? (
          <>
            <Input label="이름" value={props.name} onChangeText={props.setName} placeholder="작업자명" />
            <Input label="회사명" value={props.companyName} onChangeText={props.setCompanyName} placeholder="회사명을 입력하세요" />
          </>
        ) : null}

        <Pressable style={[styles.primaryAction, props.authBusy && styles.disabledButton]} disabled={props.authBusy} onPress={() => void props.submit()}>
          {props.authBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryActionText}>{props.authMode === "login" ? "로그인" : "계정 생성"}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function HomeScreen(props: {
  canCapture: boolean;
  joinKey: string;
  loadingProjects: boolean;
  loadingRooms: boolean;
  logout: () => void;
  pickImages: () => Promise<void>;
  previewJoinProject: () => Promise<void>;
  projects: Project[];
  projectId: string;
  rooms: Room[];
  selectedProject: Project | null;
  selectProject: (projectId: string) => Promise<void>;
  setJoinKey: (value: string) => void;
  takePhoto: () => Promise<void>;
  user: User | null;
}) {
  return (
    <View style={styles.homeLayout}>
      <View style={styles.topBar}>
        <View style={styles.topBarIdentity}>
          <Text style={styles.topBarLabel}>{roleLabel(props.user?.role ?? "WORKER")}</Text>
          <Text style={styles.topBarValue}>{props.user?.name}</Text>
          <Text style={styles.topBarSubvalue}>{props.user?.email}</Text>
        </View>
        <Pressable style={styles.ghostButton} onPress={props.logout}>
          <Text style={styles.ghostButtonText}>로그아웃</Text>
        </Pressable>
      </View>

      <View style={styles.projectSelectorBand}>
        <View style={styles.projectSelectorHeader}>
          <View>
            <Text style={styles.microLabel}>프로젝트 선택</Text>
            <Text style={styles.projectSelectorTitle}>{props.selectedProject?.name ?? "프로젝트를 선택하세요"}</Text>
          </View>
          {props.loadingProjects ? <ActivityIndicator color="#0F172A" /> : <StatusPill label={`${props.rooms.length}개 방`} tone={props.rooms.length > 0 ? "green" : "gray"} />}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.projectRow}>
          {props.projects.map((project) => (
            <Pressable
              key={project.id}
              style={[styles.projectChip, project.id === props.projectId && styles.projectChipActive]}
              onPress={() => void props.selectProject(project.id)}
            >
              <Text style={[styles.projectName, project.id === props.projectId && styles.projectNameActive]} numberOfLines={1}>
                {project.name}
              </Text>
              <Text style={styles.projectCode}>{project.code}</Text>
            </Pressable>
          ))}

          {props.projects.length === 0 && !props.loadingProjects ? (
            <View style={styles.emptyPill}>
              <Text style={styles.emptyPillText}>참여한 프로젝트 없음</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View style={styles.captureStage}>
        <View style={styles.captureGraphic}>
          <CameraGlyph large />
        </View>
        <Text style={styles.captureTitle}>{props.selectedProject ? "사진 촬영" : "프로젝트 먼저 선택"}</Text>
        <Text style={styles.captureDescription}>
          {props.selectedProject ? "가운데 카메라 버튼으로 촬영한 뒤 층과 방을 지정해 업로드하세요." : "프로젝트를 선택하면 카메라 버튼을 사용할 수 있습니다."}
        </Text>

        <Pressable style={[styles.cameraButton, !props.canCapture && styles.disabledButton]} disabled={!props.canCapture} onPress={() => void props.takePhoto()}>
          <CameraGlyph />
          <Text style={styles.cameraButtonText}>사진 촬영</Text>
        </Pressable>

        <Pressable style={[styles.secondaryAction, !props.canCapture && styles.disabledButton]} disabled={!props.canCapture} onPress={() => void props.pickImages()}>
          <Text style={styles.secondaryActionText}>앨범에서 선택</Text>
        </Pressable>

        <View style={styles.infoRowCentered}>
          <StatusPill label={props.selectedProject ? "프로젝트 준비됨" : "프로젝트 필요"} tone={props.selectedProject ? "blue" : "gray"} />
          <StatusPill label={props.loadingRooms ? "방 로딩 중" : `${props.rooms.length}개 방`} tone={props.rooms.length > 0 ? "green" : "gray"} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>접근키로 프로젝트 참여</Text>
        <Text style={styles.cardDescription}>관리자가 공유한 프로젝트 접근키로 현장을 추가합니다.</Text>
        <Input label="프로젝트 접근키" value={props.joinKey} onChangeText={props.setJoinKey} placeholder="접근키 입력" autoCapitalize="none" autoCorrect={false} />
        <Pressable style={styles.secondaryActionWide} onPress={() => void props.previewJoinProject()}>
          <Text style={styles.secondaryActionText}>확인 후 참여</Text>
        </Pressable>
      </View>
    </View>
  );
}

function UploadScreen(props: {
  clearDraft: () => void;
  images: ImagePicker.ImagePickerAsset[];
  meta: UploadMeta;
  openRoomPicker: () => void;
  pickImages: () => Promise<void>;
  readyToUpload: boolean;
  removeImage: (index: number) => void;
  roomProgress: string;
  roomProgressTone: PillTone;
  selectedProject: Project | null;
  selectedRoom: Room | null;
  setMeta: React.Dispatch<React.SetStateAction<UploadMeta>>;
  takePhoto: () => Promise<void>;
  upload: () => Promise<void>;
  uploading: boolean;
}) {
  const heroImage = props.images[0]?.uri;

  return (
    <View style={styles.uploadLayout}>
      <View style={styles.topBar}>
        <View style={styles.topBarIdentity}>
          <Text style={styles.topBarLabel}>사진 업로드</Text>
          <Text style={styles.topBarValue}>{props.selectedProject?.name ?? "프로젝트 없음"}</Text>
          <Text style={styles.topBarSubvalue}>{props.images.length}장 선택됨</Text>
        </View>
        <Pressable style={styles.ghostButton} onPress={props.clearDraft}>
          <Text style={styles.ghostButtonText}>초기화</Text>
        </Pressable>
      </View>

      <View style={styles.previewPanel}>
        <View style={styles.previewFrame}>{heroImage ? <Image source={{ uri: heroImage }} style={styles.heroPreview} /> : <CameraGlyph large />}</View>
        <View style={styles.previewSummary}>
          <Text style={styles.sectionTitle}>사진 미리보기</Text>
          <Text style={styles.cardDescription}>촬영한 사진을 확인한 뒤 방, 공사면, 공종, 작업 내용을 입력합니다.</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
          {props.images.map((image, index) => (
            <View key={`${image.uri}-${index}`} style={styles.thumbnailCard}>
              <Image source={{ uri: image.uri }} style={styles.thumbnailImage} />
              <Pressable style={styles.thumbnailRemoveButton} onPress={() => props.removeImage(index)}>
                <Text style={styles.thumbnailRemoveText}>삭제</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>

        <View style={styles.quickActionRow}>
          <Pressable style={styles.secondaryActionInline} onPress={() => void props.takePhoto()}>
            <Text style={styles.secondaryActionText}>다시 촬영</Text>
          </Pressable>
          <Pressable style={styles.secondaryActionInline} onPress={() => void props.pickImages()}>
            <Text style={styles.secondaryActionText}>앨범 추가</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.flexOne}>
            <Text style={styles.sectionTitle}>방 선택</Text>
            <Text style={styles.cardDescription}>방이 많아도 빠르게 고를 수 있도록 층별로 묶어 표시합니다.</Text>
          </View>
          <StatusPill label={props.roomProgress} tone={props.roomProgressTone} />
        </View>

        <Pressable style={styles.roomSelector} onPress={props.openRoomPicker}>
          <View style={styles.roomSelectorText}>
            <Text style={styles.roomSelectorLabel}>선택된 방</Text>
            <Text style={styles.roomSelectorValue}>{props.selectedRoom ? roomTitle(props.selectedRoom) : "방을 선택하세요"}</Text>
            <Text style={styles.roomSelectorMeta}>
              {props.selectedRoom ? `${props.selectedRoom.level_name ?? "층 정보 없음"} - ${props.selectedRoom.bim_photo_room_id}` : "눌러서 층별 방 목록 열기"}
            </Text>
          </View>
          <Text style={styles.disclosure}>선택</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>업로드 정보</Text>
        <Selector
          label="공사면"
          value={props.meta.work_surface}
          values={surfaces}
          onChange={(work_surface) => props.setMeta((current) => ({ ...current, work_surface: work_surface as SurfaceCode }))}
        />
        <Selector label="공종" value={props.meta.trade} values={trades} onChange={(trade) => props.setMeta((current) => ({ ...current, trade: trade as TradeCode }))} />
        <Input label="작업일자" value={props.meta.work_date} onChangeText={(work_date) => props.setMeta((current) => ({ ...current, work_date }))} placeholder="YYYY-MM-DD" />
        <Input label="작업자" value={props.meta.worker_name} onChangeText={(worker_name) => props.setMeta((current) => ({ ...current, worker_name }))} placeholder="작업자명" />
        <Input
          label="작업 내용"
          value={props.meta.description}
          onChangeText={(description) => props.setMeta((current) => ({ ...current, description }))}
          placeholder="진행 상황, 완료 여부, 특이사항을 입력하세요."
          multiline
        />
      </View>

      <View style={styles.submitPanel}>
        <View style={styles.infoRow}>
          <StatusPill label={`${props.images.length}장`} tone={props.images.length > 0 ? "blue" : "gray"} />
          <StatusPill label={props.selectedRoom ? props.roomProgress : "방 선택 필요"} tone={props.selectedRoom ? props.roomProgressTone : "gray"} />
        </View>

        <Pressable style={[styles.uploadButton, !props.readyToUpload && styles.disabledButton]} disabled={!props.readyToUpload} onPress={() => void props.upload()}>
          {props.uploading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryActionText}>선택한 방에 업로드</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function RoomPickerModal(props: {
  loadingRooms: boolean;
  meta: UploadMeta;
  roomId: string;
  roomSearch: string;
  roomSections: RoomSection[];
  selectedProject: Project | null;
  setRoomId: (value: string) => void;
  setRoomPickerVisible: (value: boolean) => void;
  setRoomSearch: (value: string) => void;
  setStatus: (value: string) => void;
  visible: boolean;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => props.setRoomPickerVisible(false)}>
      <KeyboardAvoidingView style={styles.modalKeyboardRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalDismissArea} onPress={() => props.setRoomPickerVisible(false)} />
          <SafeAreaView style={styles.sheetSafe}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <View style={styles.flexOne}>
                  <Text style={styles.sheetTitle}>방 선택</Text>
                  <Text style={styles.sheetSubtitle}>{props.selectedProject?.name ?? "선택된 프로젝트 없음"}</Text>
                </View>
                {props.loadingRooms ? <ActivityIndicator color="#0F172A" /> : <StatusPill label={`${roomCount(props.roomSections)}개 방`} tone={roomCount(props.roomSections) > 0 ? "green" : "gray"} />}
              </View>

              <TextInput
                style={styles.searchInput}
                placeholder="층, 방 번호, 방 이름, BIM ID 검색"
                placeholderTextColor="#94A3B8"
                value={props.roomSearch}
                onChangeText={props.setRoomSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />

              <SectionList
                sections={props.roomSections}
                keyExtractor={(item) => item.id}
                stickySectionHeadersEnabled={false}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.sectionListContent}
                renderSectionHeader={({ section }) => (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>{section.title}</Text>
                    <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
                  </View>
                )}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.roomRow, item.id === props.roomId && styles.roomRowActive]}
                    onPress={() => {
                      props.setRoomId(item.id);
                      props.setRoomPickerVisible(false);
                      props.setStatus(`${roomTitle(item)} 방을 선택했습니다.`);
                    }}
                  >
                    <View style={styles.roomRowText}>
                      <Text style={styles.roomRowTitle}>{roomTitle(item)}</Text>
                      <Text style={styles.roomRowMeta}>
                        {item.bim_photo_room_id} - {roomProgressLabel(item, props.meta.work_surface)}
                      </Text>
                    </View>
                    <StatusPill label={`${surfacePhotoCount(item, props.meta.work_surface)}장`} tone={progressTone(item, props.meta.work_surface)} />
                  </Pressable>
                )}
                ListEmptyComponent={
                  <View style={styles.emptySheetState}>
                    <Text style={styles.emptySheetTitle}>방을 찾을 수 없습니다</Text>
                    <Text style={styles.emptySheetBody}>검색어를 바꾸거나 프로젝트 방 목록을 새로고침하세요.</Text>
                  </View>
                }
              />
            </View>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function BimCameraHero() {
  return (
    <View style={styles.heroIllustration} pointerEvents="none">
      <View style={styles.floorPlate} />
      <View style={[styles.tower, styles.towerLeft]}>
        <BuildingWindows rows={4} />
      </View>
      <View style={[styles.tower, styles.towerRight]}>
        <BuildingWindows rows={3} />
      </View>
      <View style={styles.cameraBody}>
        <View style={styles.cameraTop} />
        <View style={styles.cameraLensOuter}>
          <View style={styles.cameraLensInner} />
        </View>
      </View>
      <View style={styles.scanLine} />
    </View>
  );
}

function BuildingWindows({ rows }: { rows: number }) {
  return (
    <View style={styles.windowGrid}>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <View key={rowIndex} style={styles.windowRow}>
          <View style={styles.windowCell} />
          <View style={styles.windowCell} />
        </View>
      ))}
    </View>
  );
}

function CameraGlyph({ large }: { large?: boolean }) {
  return (
    <View style={[styles.cameraGlyph, large && styles.cameraGlyphLarge]} pointerEvents="none">
      <View style={[styles.cameraGlyphTop, large && styles.cameraGlyphTopLarge]} />
      <View style={[styles.cameraGlyphLens, large && styles.cameraGlyphLensLarge]}>
        <View style={[styles.cameraGlyphLensCore, large && styles.cameraGlyphLensCoreLarge]} />
      </View>
    </View>
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
        scrollEnabled={multiline}
        textAlignVertical={multiline ? "top" : "center"}
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

function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
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

  return Array.from(grouped.entries()).map<RoomSection>(([title, data]) => ({
    title,
    data: [...data].sort((firstRoom, secondRoom) => roomTitle(firstRoom).localeCompare(roomTitle(secondRoom)))
  }));
}

function roomSearchText(room: Room) {
  return `${room.level_name ?? ""} ${room.room_number ?? ""} ${room.room_name} ${room.bim_photo_room_id}`.toLowerCase();
}

function roleLabel(role: string) {
  if (role === "SUPER_ADMIN") return "최고 관리자";
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

function roomCount(sections: RoomSection[]) {
  return sections.reduce((total, section) => total + section.data.length, 0);
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
    throw new Error("네트워크 연결을 확인하고 다시 시도해 주세요.");
  }

  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
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

function capitalize(value: PillTone) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` as "Blue" | "Green" | "Yellow" | "Red" | "Gray";
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F7FA"
  },
  keyboardRoot: {
    flex: 1
  },
  screenContainer: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 14
  },
  authLayout: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 16,
    gap: 16
  },
  heroPanel: {
    minHeight: 350,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "#102235",
    padding: 22,
    justifyContent: "space-between",
    gap: 18
  },
  heroIllustration: {
    height: 190,
    borderRadius: 24,
    backgroundColor: "#D9EEF7",
    overflow: "hidden"
  },
  floorPlate: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 26,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#78AFC3"
  },
  tower: {
    position: "absolute",
    bottom: 42,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#B8D5DF",
    padding: 8
  },
  towerLeft: {
    left: 34,
    width: 66,
    height: 116
  },
  towerRight: {
    right: 38,
    width: 82,
    height: 96
  },
  windowGrid: {
    gap: 8
  },
  windowRow: {
    flexDirection: "row",
    gap: 8
  },
  windowCell: {
    flex: 1,
    height: 12,
    borderRadius: 3,
    backgroundColor: "#86C5D8"
  },
  cameraBody: {
    position: "absolute",
    left: "30%",
    right: "24%",
    bottom: 40,
    height: 88,
    borderRadius: 22,
    backgroundColor: "#22364A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: "#FFFFFF"
  },
  cameraTop: {
    position: "absolute",
    top: -22,
    width: 82,
    height: 28,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: "#22364A",
    borderWidth: 5,
    borderBottomWidth: 0,
    borderColor: "#FFFFFF"
  },
  cameraLensOuter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center"
  },
  cameraLensInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#30A9C8"
  },
  scanLine: {
    position: "absolute",
    left: 26,
    right: 26,
    top: 28,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#37B6D7"
  },
  heroCopy: {
    gap: 8
  },
  heroKicker: {
    color: "#73D0F4",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "900"
  },
  heroBody: {
    color: "#C8D5E1",
    fontSize: 14,
    lineHeight: 21
  },
  authCard: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E1E8F0"
  },
  homeLayout: {
    gap: 14
  },
  uploadLayout: {
    gap: 14
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  topBarIdentity: {
    flex: 1,
    gap: 2
  },
  topBarLabel: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800"
  },
  topBarValue: {
    color: "#132235",
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "900"
  },
  topBarSubvalue: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700"
  },
  microLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
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
    fontWeight: "900"
  },
  card: {
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E1E8F0"
  },
  projectSelectorBand: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#E1E8F0"
  },
  projectSelectorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  projectSelectorTitle: {
    color: "#132235",
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900"
  },
  captureStage: {
    borderRadius: 30,
    backgroundColor: "#163047",
    paddingVertical: 26,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 13,
    overflow: "hidden"
  },
  captureGraphic: {
    width: 132,
    height: 108,
    borderRadius: 30,
    backgroundColor: "#E8F6FA",
    alignItems: "center",
    justifyContent: "center"
  },
  captureTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    textAlign: "center"
  },
  captureDescription: {
    color: "#CCE3EA",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center"
  },
  cameraButton: {
    width: 210,
    minHeight: 72,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12
  },
  cameraButtonText: {
    color: "#123049",
    fontSize: 18,
    fontWeight: "900"
  },
  cameraGlyph: {
    width: 42,
    height: 30,
    borderRadius: 9,
    backgroundColor: "#123049",
    alignItems: "center",
    justifyContent: "center"
  },
  cameraGlyphLarge: {
    width: 72,
    height: 52,
    borderRadius: 16
  },
  cameraGlyphTop: {
    position: "absolute",
    top: -7,
    width: 22,
    height: 9,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    backgroundColor: "#123049"
  },
  cameraGlyphTopLarge: {
    top: -11,
    width: 36,
    height: 14
  },
  cameraGlyphLens: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center"
  },
  cameraGlyphLensLarge: {
    width: 30,
    height: 30,
    borderRadius: 15
  },
  cameraGlyphLensCore: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#2CA8C2"
  },
  cameraGlyphLensCoreLarge: {
    width: 16,
    height: 16,
    borderRadius: 8
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  flexOne: {
    flex: 1
  },
  sectionTitle: {
    color: "#132235",
    fontSize: 19,
    lineHeight: 24,
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
    marginBottom: 2
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC"
  },
  segmentActive: {
    borderColor: "#1E9ABB",
    backgroundColor: "#DFF4FA"
  },
  segmentText: {
    color: "#475569",
    fontWeight: "900"
  },
  segmentTextActive: {
    color: "#106179"
  },
  roleRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2
  },
  roleButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC"
  },
  roleButtonActive: {
    borderColor: "#1E9ABB",
    backgroundColor: "#DFF4FA"
  },
  roleButtonText: {
    color: "#334155",
    fontWeight: "900"
  },
  roleButtonTextActive: {
    color: "#106179"
  },
  field: {
    gap: 6,
    marginTop: 4
  },
  label: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "900"
  },
  input: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 14,
    color: "#132235",
    backgroundColor: "#FFFFFF",
    fontSize: 15
  },
  textarea: {
    minHeight: 118,
    paddingTop: 14
  },
  primaryAction: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#187C9B",
    marginTop: 8
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
    borderColor: "#93D0DF",
    backgroundColor: "#F8FAFC"
  },
  secondaryActionWide: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1E9ABB",
    backgroundColor: "#F8FAFC",
    marginTop: 8
  },
  secondaryActionInline: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC"
  },
  secondaryActionText: {
    color: "#106179",
    fontWeight: "900",
    textAlign: "center"
  },
  uploadButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#198754",
    marginTop: 8
  },
  disabledButton: {
    opacity: 0.5
  },
  projectRow: {
    gap: 10,
    paddingVertical: 2
  },
  projectChip: {
    width: 178,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    padding: 13,
    gap: 4,
    backgroundColor: "#F8FAFC"
  },
  projectChipActive: {
    borderColor: "#1E9ABB",
    backgroundColor: "#DFF4FA"
  },
  projectName: {
    color: "#132235",
    fontSize: 15,
    fontWeight: "900"
  },
  projectNameActive: {
    color: "#106179"
  },
  projectCode: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800"
  },
  emptyPill: {
    minHeight: 60,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC"
  },
  emptyPillText: {
    color: "#64748B",
    fontWeight: "800"
  },
  infoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  infoRowCentered: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
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
    color: "#132235",
    fontSize: 12,
    fontWeight: "900"
  },
  statusPillTextMuted: {
    color: "#475569"
  },
  pillBlue: {
    backgroundColor: "#D8EEF6"
  },
  pillGreen: {
    backgroundColor: "#DDF6E8"
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
  previewPanel: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: "#E1E8F0"
  },
  previewFrame: {
    width: "100%",
    height: 250,
    borderRadius: 20,
    backgroundColor: "#E8F1F5",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  heroPreview: {
    width: "100%",
    height: "100%",
    backgroundColor: "#E2E8F0"
  },
  previewSummary: {
    gap: 4
  },
  thumbnailRow: {
    gap: 10,
    paddingVertical: 2
  },
  thumbnailCard: {
    width: 112,
    gap: 6
  },
  thumbnailImage: {
    width: 112,
    height: 112,
    borderRadius: 16,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    padding: 15,
    backgroundColor: "#F8FAFC"
  },
  roomSelectorText: {
    flex: 1,
    gap: 3
  },
  roomSelectorLabel: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "900"
  },
  roomSelectorValue: {
    color: "#132235",
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900"
  },
  roomSelectorMeta: {
    color: "#64748B",
    fontSize: 12,
    lineHeight: 18
  },
  disclosure: {
    color: "#106179",
    fontSize: 13,
    fontWeight: "900"
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
    borderColor: "#1E9ABB",
    backgroundColor: "#DFF4FA"
  },
  selectorChipText: {
    color: "#334155",
    fontWeight: "900"
  },
  selectorChipTextActive: {
    color: "#106179"
  },
  submitPanel: {
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E1E8F0"
  },
  statusBanner: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    color: "#475569",
    fontSize: 13,
    lineHeight: 19,
    borderWidth: 1,
    borderColor: "#E1E8F0"
  },
  modalKeyboardRoot: {
    flex: 1
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.36)"
  },
  modalDismissArea: {
    flex: 1
  },
  sheetSafe: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28
  },
  sheet: {
    height: "82%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12
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
    color: "#132235",
    fontSize: 21,
    fontWeight: "900"
  },
  sheetSubtitle: {
    color: "#64748B",
    fontSize: 13
  },
  searchInput: {
    minHeight: 48,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 14,
    color: "#132235",
    backgroundColor: "#F8FAFC",
    marginBottom: 10
  },
  sectionListContent: {
    paddingBottom: 26
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingBottom: 7
  },
  sectionHeaderText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  sectionHeaderCount: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "900"
  },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    marginBottom: 8,
    backgroundColor: "#FFFFFF"
  },
  roomRowActive: {
    borderColor: "#1E9ABB",
    backgroundColor: "#DFF4FA"
  },
  roomRowText: {
    flex: 1,
    gap: 2
  },
  roomRowTitle: {
    color: "#132235",
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
    color: "#132235",
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
