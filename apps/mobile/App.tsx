import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";

import { AuthScreen } from "./src/components/AuthScreen";
import { LogoLockup } from "./src/components/Branding";
import {
  surfaces,
  trades,
  type AppTab,
  type AuthMode,
  type AuthResponse,
  type Photo,
  type PillTone,
  type Project,
  type RegisterRole,
  type Room,
  type RoomProgressStatus,
  type RoomSection,
  type SurfaceCode,
  type TradeCode,
  type UploadMeta,
  type User
} from "./src/domain";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api-production-1d018.up.railway.app/api/v1";

export default function App() {
  const [tab, setTab] = useState<AppTab>("home");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [registerRole, setRegisterRole] = useState<RegisterRole>("WORKER");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [roomPickerVisible, setRoomPickerVisible] = useState(false);
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [roomSearch, setRoomSearch] = useState("");
  const [roomLevelFilter, setRoomLevelFilter] = useState("");
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoRoomFilter, setPhotoRoomFilter] = useState("");
  const [projectPhotosVisible, setProjectPhotosVisible] = useState(false);
  const [status, setStatus] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [meta, setMeta] = useState<UploadMeta>({
    work_surface: "FLOOR",
    trade: "OTHER",
    description: ""
  });

  const deferredRoomSearch = useDeferredValue(roomSearch);
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projectId, projects]);
  const selectedRoom = useMemo(() => rooms.find((room) => room.id === roomId) ?? null, [roomId, rooms]);
  const roomSections = useMemo(() => buildRoomSections(rooms, deferredRoomSearch, roomLevelFilter), [deferredRoomSearch, roomLevelFilter, rooms]);
  const roomLevelFilters = useMemo(() => roomLevelNames(rooms), [rooms]);
  const filteredPhotos = useMemo(() => {
    if (!photoRoomFilter) return photos;
    return photos.filter((photo) => photo.room_id === photoRoomFilter);
  }, [photoRoomFilter, photos]);
  const isAuthenticated = Boolean(token && user);
  const isUploadStage = isAuthenticated && images.length > 0;
  const canAddPhotos = Boolean(projectId) && !loadingRooms && !loadingProjects;
  const readyToUpload = Boolean(token && projectId && roomId && images.length > 0) && !uploading;
  const { width: screenWidth } = useWindowDimensions();
  const compactLayout = screenWidth < 380;
  const safeTopPadding = Platform.OS === "android" ? Math.max(24, RNStatusBar.currentHeight ?? 0) + 14 : 12;
  const safeBottomPadding = Platform.OS === "android" ? 36 : 28;

  useEffect(() => {
    if (!token || !projectId) return;
    void loadPhotos(token, projectId, photoRoomFilter).catch((error: unknown) => setStatus(getErrorMessage(error, "사진을 불러오지 못했습니다.")));
  }, [photoRoomFilter]);

  async function authenticate() {
    if (!email.trim() || !password.trim()) {
      showMessage("입력 확인", "이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    if (authMode === "register") {
      if (!name.trim()) {
        showMessage("입력 확인", "이름을 입력해 주세요.");
        return;
      }
      if (!companyName.trim()) {
        showMessage("입력 확인", "회사명을 입력해 주세요.");
        return;
      }
      if (password.length < 8) {
        showMessage("입력 확인", "비밀번호는 8자 이상이어야 합니다.");
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
      setTab("home");
      setStatus(`${json.data.user.name} 계정으로 로그인했습니다.`);
      await loadProjects(json.data.access_token);
    } catch (error) {
      showMessage("오류", getErrorMessage(error, "로그인에 실패했습니다."));
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
      setPhotoRoomFilter("");
      if (nextProjectId) {
        await loadRooms(nextToken, nextProjectId);
        await loadPhotos(nextToken, nextProjectId, "");
      } else {
        setRooms([]);
        setRoomId("");
        setPhotos([]);
        setStatus("참여한 프로젝트가 없습니다. 프로젝트 탭에서 접근키를 입력하세요.");
      }
    } catch (error) {
      setProjects([]);
      setProjectId("");
      setRooms([]);
      setRoomId("");
      setPhotos([]);
      throw error;
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId, preferredRoomId = roomId) {
    if (!nextToken || !nextProjectId) {
      setRooms([]);
      setRoomId("");
      return;
    }

    setLoadingRooms(true);
    try {
      const json = await apiJson<{ data: Room[] }>(`/projects/${nextProjectId}/rooms`, { headers: authHeaders(nextToken) });
      const nextRooms = Array.isArray(json.data) ? json.data : [];
      const nextRoomId = nextRooms.some((room) => room.id === preferredRoomId) ? preferredRoomId : nextRooms[0]?.id ?? "";
      setRooms(nextRooms);
      setRoomId(nextRoomId);
      setStatus(nextRooms.length === 0 ? "이 프로젝트에 등록된 방이 없습니다." : `${nextRooms.length}개 방을 불러왔습니다.`);
    } finally {
      setLoadingRooms(false);
    }
  }

  async function loadPhotos(nextToken = token, nextProjectId = projectId, nextRoomId = photoRoomFilter) {
    if (!nextToken || !nextProjectId) return;
    setLoadingPhotos(true);
    try {
      const params = new URLSearchParams({ project_id: nextProjectId });
      if (nextRoomId) params.set("room_id", nextRoomId);
      const json = await apiJson<{ data: Photo[]; total: number }>(`/photos?${params.toString()}`, { headers: authHeaders(nextToken) });
      const nextPhotos = Array.isArray(json.data) ? json.data : [];
      setPhotos(nextPhotos);
      setStatus(`${json.total}개 사진을 불러왔습니다.`);
    } finally {
      setLoadingPhotos(false);
    }
  }

  async function previewJoinProject() {
    if (!token) return;
    const accessKey = joinKey.trim();
    if (!accessKey) {
      showMessage("입력 확인", "프로젝트 접근키를 입력해 주세요.");
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
        { text: "참여", onPress: () => void joinProject(accessKey) }
      ]);
    } catch (error) {
      showMessage("오류", getErrorMessage(error, "프로젝트 정보를 확인하지 못했습니다."));
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
      showMessage("오류", getErrorMessage(error, "프로젝트 참여에 실패했습니다."));
    }
  }

  async function selectProject(nextProjectId: string) {
    if (!token || nextProjectId === projectId) return;
    setProjectId(nextProjectId);
    setPhotoRoomFilter("");
    setRoomSearch("");
    setRoomLevelFilter("");
    try {
      await loadRooms(token, nextProjectId);
      await loadPhotos(token, nextProjectId, "");
    } catch (error) {
      showMessage("오류", getErrorMessage(error, "프로젝트 정보를 새로고침하지 못했습니다."));
    }
  }

  async function openProjectPhotos(nextProjectId: string) {
    await selectProject(nextProjectId);
    setProjectPhotosVisible(true);
  }

  function choosePhotoSource() {
    if (!canAddPhotos) {
      showMessage("프로젝트 선택", "사진 추가 전에 프로젝트를 선택하세요.");
      return;
    }

    Alert.alert("사진 추가", "사진을 어떻게 추가할까요?", [
      { text: "카메라로 촬영", onPress: () => void takePhoto() },
      { text: "갤러리에서 선택", onPress: () => void pickImages() },
      { text: "취소", style: "cancel" }
    ]);
  }

  async function takePhoto() {
    if (!projectId) {
      showMessage("프로젝트 선택", "사진 촬영 전에 프로젝트를 선택하세요.");
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("카메라 권한 필요", "현장 사진을 촬영할 수 있도록 카메라 접근을 허용해 주세요.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled) return;
    setImages((current) => [...current, ...result.assets]);
    setStatus(`${result.assets.length}장 사진을 업로드 초안에 추가했습니다.`);
  }

  async function pickImages() {
    if (!projectId) {
      showMessage("프로젝트 선택", "사진 선택 전에 프로젝트를 선택하세요.");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("사진 접근 권한 필요", "현장 사진을 선택할 수 있도록 사진 접근을 허용해 주세요.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
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
          setMeta((current) => ({ ...current, description: "" }));
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
        const putResponse = await fetch(presign.data.presigned_url, { method: "PUT", headers: { "Content-Type": mime }, body: blob });
        if (!putResponse.ok) throw new Error(`파일 업로드에 실패했습니다: ${putResponse.status}`);

        await apiJson("/photos", {
          method: "POST",
          headers: { ...authHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            room_id: roomId,
            upload_id: presign.data.upload_id,
            work_surface: meta.work_surface,
            trade: meta.trade,
            work_date: todayValue(),
            worker_name: user?.name ?? "",
            description: meta.description
          })
        });
      }

      setImages([]);
      setMeta((current) => ({ ...current, description: "" }));
      setStatus("사진 업로드가 완료되었고 AI 분석 대기열에 등록되었습니다.");
      Alert.alert("업로드 완료", "선택한 방에 사진이 연결되었습니다.");
      await loadRooms(token, projectId, roomId);
      await loadPhotos(token, projectId, roomId);
      setPhotoRoomFilter(roomId);
      setTab("projects");
    } catch (error) {
      showMessage("오류", getErrorMessage(error, "사진 업로드에 실패했습니다."));
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
    setPhotos([]);
    setPhotoRoomFilter("");
    setRoomSearch("");
    setRoomLevelFilter("");
    setRoomPickerVisible(false);
    setEmail("");
    setPassword("");
    setTab("home");
    setStatus("로그아웃했습니다.");
    setMeta({ work_surface: "FLOOR", trade: "OTHER", description: "" });
  }

  function openRoomPicker() {
    if (!projectId) {
      Alert.alert("프로젝트 선택", "방을 선택하기 전에 프로젝트를 선택하세요.");
      return;
    }
    setRoomSearch("");
    setRoomLevelFilter("");
    setRoomPickerVisible(true);
  }

  function showMessage(title: string, message: string) {
    setStatus(message);
    Alert.alert(title, message);
  }

  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.keyboardRoot} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[
            styles.screenContainer,
            { paddingTop: safeTopPadding, paddingBottom: isAuthenticated && !isUploadStage ? safeBottomPadding + 112 : safeBottomPadding },
            compactLayout ? styles.screenContainerCompact : null
          ]}
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
              rememberLogin={rememberLogin}
              setAuthMode={setAuthMode}
              setCompanyName={setCompanyName}
              setEmail={setEmail}
              setName={setName}
              setPassword={setPassword}
              setRegisterRole={setRegisterRole}
              setRememberLogin={setRememberLogin}
              submit={authenticate}
            />
          ) : null}

          {isAuthenticated && !isUploadStage && tab === "home" ? (
            <HomeScreen
              canAddPhotos={canAddPhotos}
              choosePhotoSource={choosePhotoSource}
              loadingProjects={loadingProjects}
              loadingRooms={loadingRooms}
              projects={projects}
              projectId={projectId}
              rooms={rooms}
              selectedProject={selectedProject}
              openProjectPicker={() => setProjectPickerVisible(true)}
              selectProject={selectProject}
            />
          ) : null}

          {isAuthenticated && !isUploadStage && tab === "projects" ? (
            <ProjectsScreen
              joinKey={joinKey}
              loadingPhotos={loadingPhotos}
              photoRoomFilter={photoRoomFilter}
              photosVisible={projectPhotosVisible}
              photos={filteredPhotos}
              previewJoinProject={previewJoinProject}
              projects={projects}
              projectId={projectId}
              rooms={rooms}
              openProjectPhotos={openProjectPhotos}
              selectProject={selectProject}
              selectedProject={selectedProject}
              setJoinKey={setJoinKey}
              setPhotosVisible={setProjectPhotosVisible}
              setPhotoRoomFilter={setPhotoRoomFilter}
            />
          ) : null}

          {isAuthenticated && !isUploadStage && tab === "profile" ? <ProfileScreen logout={logout} projects={projects} rooms={rooms} user={user} /> : null}

          {isAuthenticated && isUploadStage ? (
            <UploadScreen
              choosePhotoSource={choosePhotoSource}
              clearDraft={clearDraft}
              compact={compactLayout}
              images={images}
              meta={meta}
              openRoomPicker={openRoomPicker}
              readyToUpload={readyToUpload}
              removeImage={removeImage}
              selectedProject={selectedProject}
              selectedRoom={selectedRoom}
              setImages={setImages}
              setMeta={setMeta}
              upload={upload}
              uploading={uploading}
            />
          ) : null}

          {!isAuthenticated && status ? <Text style={styles.statusBanner}>{status}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {isAuthenticated && !isUploadStage ? (
        <BottomTabs
          active={tab}
          setActive={(nextTab) => {
            if (nextTab === "projects") setProjectPhotosVisible(false);
            setTab(nextTab);
          }}
        />
      ) : null}

      <RoomPickerModal
        loadingRooms={loadingRooms}
        meta={meta}
        roomId={roomId}
        roomSearch={roomSearch}
        roomSections={roomSections}
        roomLevelFilter={roomLevelFilter}
        roomLevelFilters={roomLevelFilters}
        selectedProject={selectedProject}
        setRoomId={setRoomId}
        setRoomLevelFilter={setRoomLevelFilter}
        setRoomPickerVisible={setRoomPickerVisible}
        setRoomSearch={setRoomSearch}
        setStatus={setStatus}
        visible={roomPickerVisible}
      />

      <ProjectPickerModal
        loadingProjects={loadingProjects}
        projectId={projectId}
        projects={projects}
        selectProject={selectProject}
        setProjectPickerVisible={setProjectPickerVisible}
        visible={projectPickerVisible}
      />
    </View>
  );
}

function HomeScreen(props: {
  canAddPhotos: boolean;
  choosePhotoSource: () => void;
  loadingProjects: boolean;
  loadingRooms: boolean;
  projects: Project[];
  projectId: string;
  rooms: Room[];
  selectedProject: Project | null;
  openProjectPicker: () => void;
  selectProject: (projectId: string) => Promise<void>;
}) {
  return (
    <View style={styles.homeLayout}>
      <View style={styles.homeHeader}>
        <LogoLockup />
      </View>

      <Text style={styles.pageTitle}>프로젝트 선택</Text>
      <Pressable style={styles.projectHeroCard} onPress={props.openProjectPicker}>
        <View style={styles.projectHeroText}>
          <Text style={styles.projectEyebrow}>현재 프로젝트</Text>
          <Text style={styles.projectSelectorTitle}>{props.selectedProject?.name ?? "프로젝트를 선택하세요"}</Text>
          <Text style={styles.projectSelectorMeta}>
            {props.selectedProject ? `${props.selectedProject.code} | ${props.rooms.length}개 방` : "프로젝트 탭에서 접근키로 참여하세요"}
          </Text>
        </View>
        {props.loadingProjects || props.loadingRooms ? <ActivityIndicator color="#2563EB" /> : <ChevronDownIcon />}
      </Pressable>

      <View style={styles.captureFrame}>
        <View style={styles.cornerTopLeft} />
        <View style={styles.cornerTopRight} />
        <View style={styles.cornerBottomLeft} />
        <View style={styles.cornerBottomRight} />
        <Pressable style={[styles.cameraCircle, !props.canAddPhotos && styles.disabledButton]} disabled={!props.canAddPhotos} onPress={props.choosePhotoSource}>
          <CameraLineIcon white />
        </Pressable>
        <Text style={styles.captureTitle}>사진 촬영</Text>
        <Text style={styles.captureDescription}>버튼을 눌러 사진을 촬영하거나 갤러리에서 추가하세요.</Text>
      </View>
    </View>
  );
}

function ProjectsScreen(props: {
  joinKey: string;
  loadingPhotos: boolean;
  photoRoomFilter: string;
  photosVisible: boolean;
  photos: Photo[];
  previewJoinProject: () => Promise<void>;
  projects: Project[];
  projectId: string;
  rooms: Room[];
  openProjectPhotos: (projectId: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  selectedProject: Project | null;
  setJoinKey: (value: string) => void;
  setPhotosVisible: (value: boolean) => void;
  setPhotoRoomFilter: (value: string) => void;
}) {
  if (props.photosVisible) {
    return (
      <View style={styles.homeLayout}>
        <View style={styles.detailTopRow}>
          <Pressable style={styles.backPill} onPress={() => props.setPhotosVisible(false)}>
            <Text style={styles.backPillText}>‹ 프로젝트</Text>
          </Pressable>
          {props.loadingPhotos ? <ActivityIndicator color="#2563EB" /> : <StatusPill label={`${props.photos.length}장`} tone={props.photos.length > 0 ? "blue" : "gray"} />}
        </View>
        <Text style={styles.pageTitle}>{props.selectedProject?.name ?? "프로젝트"} 사진</Text>
        <Text style={styles.pageDescription}>방별 필터로 업로드된 현장 사진을 확인합니다.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomFilterRow}>
          <FilterChip label="전체" active={!props.photoRoomFilter} onPress={() => props.setPhotoRoomFilter("")} />
          {props.rooms.map((room) => (
            <FilterChip key={room.id} label={roomTitle(room)} active={props.photoRoomFilter === room.id} onPress={() => props.setPhotoRoomFilter(room.id)} />
          ))}
        </ScrollView>
        <View style={styles.photoGrid}>
          {props.photos.map((photo) => (
            <View key={photo.id} style={styles.photoCard}>
              <Image source={{ uri: photo.photo_url }} style={styles.photoImage} resizeMode="cover" />
              <View style={styles.photoCardBody}>
                <Text style={styles.photoTitle} numberOfLines={1}>{photoTitle(photo, props.rooms)}</Text>
                <Text style={styles.photoMeta} numberOfLines={3}>{photo.work_date} | {labelFor(surfaces, photo.work_surface)} | {photo.description ?? "작업 내용 없음"}</Text>
              </View>
            </View>
          ))}
          {props.photos.length === 0 ? <Text style={styles.emptyText}>선택 조건에 맞는 사진이 없습니다.</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.homeLayout}>
      <Text style={styles.pageTitle}>프로젝트</Text>
      <Text style={styles.pageDescription}>참여 중인 프로젝트를 확인하고, 접근키로 새 프로젝트에 참여합니다.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>참여 중인 프로젝트</Text>
        {props.projects.map((project) => (
          <Pressable key={project.id} style={[styles.projectListItem, project.id === props.projectId && styles.projectListItemActive]} onPress={() => void props.openProjectPhotos(project.id)}>
            <View style={styles.flexOne}>
              <Text style={styles.projectName}>{project.name}</Text>
              <Text style={styles.projectCode}>{project.code} | {project.member_role ?? "참여중"}</Text>
            </View>
            <ChevronRightIcon />
          </Pressable>
        ))}
        {props.projects.length === 0 ? <Text style={styles.emptyText}>참여 중인 프로젝트가 없습니다.</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>접근키로 프로젝트 참여</Text>
        <Text style={styles.cardDescription}>관리자가 공유한 접근키를 입력하면 프로젝트에 참여할 수 있습니다.</Text>
        <Input value={props.joinKey} onChangeText={props.setJoinKey} placeholder="프로젝트 접근키" autoCapitalize="none" autoCorrect={false} />
        <Pressable style={styles.secondaryActionWide} onPress={() => void props.previewJoinProject()}>
          <Text style={styles.secondaryActionText}>확인 후 참여</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProfileScreen({ logout, projects, rooms, user }: { logout: () => void; projects: Project[]; rooms: Room[]; user: User | null }) {
  return (
    <View style={styles.homeLayout}>
      <Text style={styles.pageTitle}>내 정보</Text>
      <View style={styles.profileCard}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{user?.name?.slice(0, 1) ?? "U"}</Text>
        </View>
        <Text style={styles.profileName}>{user?.name ?? "-"}</Text>
        <Text style={styles.profileEmail}>{user?.email ?? "-"}</Text>
        <StatusPill label={roleLabel(user?.role ?? "WORKER")} tone="blue" />
      </View>
      <View style={styles.card}>
        <InfoRow label="회사" value={user?.company_name ?? "회사 정보 없음"} />
        <InfoRow label="권한" value={roleLabel(user?.role ?? "WORKER")} />
        <InfoRow label="참여 프로젝트" value={`${projects.length}개`} />
        <InfoRow label="현재 방 데이터" value={`${rooms.length}개`} />
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Revit Add-in 사용 흐름</Text>
        <Text style={styles.cardDescription}>Revit에서 프로젝트 연결 후 Room Sync, Floor Plan/Sheet/3D Model 동기화를 실행하면 웹과 앱에서 Room 기준 사진을 볼 수 있습니다.</Text>
      </View>
      <Pressable style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutButtonText}>로그아웃</Text>
      </Pressable>
    </View>
  );
}

function UploadScreen(props: {
  choosePhotoSource: () => void;
  clearDraft: () => void;
  compact: boolean;
  images: ImagePicker.ImagePickerAsset[];
  meta: UploadMeta;
  openRoomPicker: () => void;
  readyToUpload: boolean;
  removeImage: (index: number) => void;
  selectedProject: Project | null;
  selectedRoom: Room | null;
  setImages: React.Dispatch<React.SetStateAction<ImagePicker.ImagePickerAsset[]>>;
  setMeta: React.Dispatch<React.SetStateAction<UploadMeta>>;
  upload: () => Promise<void>;
  uploading: boolean;
}) {
  return (
    <View style={styles.uploadLayout}>
      <View style={styles.uploadTopBar}>
        <Pressable style={styles.roundIconButton} onPress={props.clearDraft}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.uploadTitle}>사진 업로드</Text>
        <Pressable style={styles.roundIconButton} onPress={props.choosePhotoSource}>
          <UploadCloudIcon />
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.sectionTitle}>사진</Text>
          <StatusPill label={`${props.images.length}장`} tone={props.images.length > 0 ? "blue" : "gray"} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
          {props.images.map((image, index) => (
            <View key={`${image.uri}-${index}`} style={props.compact ? styles.thumbnailCardCompact : styles.thumbnailCard}>
              <Image source={{ uri: image.uri }} style={props.compact ? styles.thumbnailImageCompact : styles.thumbnailImage} />
              <Pressable style={styles.thumbnailRemoveButton} onPress={() => props.removeImage(index)}>
                <Text style={styles.thumbnailRemoveText}>삭제</Text>
              </Pressable>
            </View>
          ))}
          <Pressable style={props.compact ? styles.addPhotoCardCompact : styles.addPhotoCard} onPress={props.choosePhotoSource}>
            <ImageIcon />
            <Text style={styles.addPhotoText}>사진 추가</Text>
            <Text style={styles.addPhotoHint}>카메라 / 갤러리</Text>
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.card}>
        <InputLabel label="프로젝트명" value={props.selectedProject?.name ?? "프로젝트 없음"} />
        <Pressable style={styles.selectBox} onPress={props.openRoomPicker}>
          <View style={styles.flexOne}>
            <Text style={styles.label}>방</Text>
            <Text style={styles.selectValue}>{props.selectedRoom ? roomTitle(props.selectedRoom) : "방을 선택하세요"}</Text>
          </View>
          <ChevronDownIcon />
        </Pressable>
        <Selector label="공사면" value={props.meta.work_surface} values={surfaces} onChange={(work_surface) => props.setMeta((current) => ({ ...current, work_surface: work_surface as SurfaceCode }))} />
        <Selector label="공종" value={props.meta.trade} values={trades} onChange={(trade) => props.setMeta((current) => ({ ...current, trade: trade as TradeCode }))} />
        <Input
          label="내용"
          value={props.meta.description}
          onChangeText={(description) => props.setMeta((current) => ({ ...current, description }))}
          placeholder="내용을 입력하세요."
          multiline
        />
      </View>

      <View style={styles.submitPanel}>
        <Pressable style={[styles.uploadButton, !props.readyToUpload && styles.disabledButton]} disabled={!props.readyToUpload} onPress={() => void props.upload()}>
          {props.uploading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryActionText}>업로드</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function RoomPickerModal(props: {
  loadingRooms: boolean;
  meta: UploadMeta;
  roomId: string;
  roomLevelFilter: string;
  roomLevelFilters: string[];
  roomSearch: string;
  roomSections: RoomSection[];
  selectedProject: Project | null;
  setRoomId: (value: string) => void;
  setRoomLevelFilter: (value: string) => void;
  setRoomPickerVisible: (value: boolean) => void;
  setRoomSearch: (value: string) => void;
  setStatus: (value: string) => void;
  visible: boolean;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => props.setRoomPickerVisible(false)}>
      <KeyboardAvoidingView style={styles.modalKeyboardRoot} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalDismissArea} onPress={() => props.setRoomPickerVisible(false)} />
          <View style={styles.sheetSafe}>
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.levelFilterRow} keyboardShouldPersistTaps="handled">
                <FilterChip label="전체" active={!props.roomLevelFilter} onPress={() => props.setRoomLevelFilter("")} />
                {props.roomLevelFilters.map((level) => (
                  <FilterChip key={level} label={level} active={props.roomLevelFilter === level} onPress={() => props.setRoomLevelFilter(level)} />
                ))}
              </ScrollView>
              <SectionList
                sections={props.roomSections}
                keyExtractor={(item) => item.id}
                stickySectionHeadersEnabled={false}
                contentInsetAdjustmentBehavior="automatic"
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
                        {item.bim_photo_room_id} | {roomProgressLabel(item, props.meta.work_surface)}
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
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ProjectPickerModal(props: {
  loadingProjects: boolean;
  projectId: string;
  projects: Project[];
  selectProject: (projectId: string) => Promise<void>;
  setProjectPickerVisible: (visible: boolean) => void;
  visible: boolean;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => props.setProjectPickerVisible(false)}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalDismissArea} onPress={() => props.setProjectPickerVisible(false)} />
        <View style={styles.sheetSafe}>
          <View style={styles.projectSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.flexOne}>
                <Text style={styles.sheetTitle}>프로젝트 선택</Text>
                <Text style={styles.sheetSubtitle}>참여 중인 프로젝트를 선택하세요.</Text>
              </View>
              {props.loadingProjects ? <ActivityIndicator color="#0F172A" /> : <StatusPill label={`${props.projects.length}개`} tone={props.projects.length > 0 ? "blue" : "gray"} />}
            </View>

            <ScrollView contentContainerStyle={styles.projectSheetList} showsVerticalScrollIndicator={false}>
              {props.projects.map((project) => (
                <Pressable
                  key={project.id}
                  style={[styles.projectPickerItem, project.id === props.projectId && styles.projectPickerItemActive]}
                  onPress={() => {
                    props.setProjectPickerVisible(false);
                    void props.selectProject(project.id);
                  }}
                >
                  <View style={styles.projectPickerIcon}>
                    <ProjectLineIcon active={project.id === props.projectId} />
                  </View>
                  <View style={styles.flexOne}>
                    <Text style={styles.projectName}>{project.name}</Text>
                    <Text style={styles.projectCode}>{project.code} | {project.member_role ?? "참여중"}</Text>
                  </View>
                  {project.id === props.projectId ? <Feather name="check" size={30} color="#1669F2" /> : <ChevronRightIcon />}
                </Pressable>
              ))}
              {props.projects.length === 0 ? <Text style={styles.emptyText}>참여 중인 프로젝트가 없습니다.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BottomTabs({ active, setActive }: { active: AppTab; setActive: (tab: AppTab) => void }) {
  return (
    <View style={styles.bottomTabs}>
      <TabButton label="홈" active={active === "home"} onPress={() => setActive("home")} icon={<HomeIcon active={active === "home"} />} />
      <TabButton label="프로젝트" active={active === "projects"} onPress={() => setActive("projects")} icon={<FolderIcon active={active === "projects"} />} />
      <TabButton label="내 정보" active={active === "profile"} onPress={() => setActive("profile")} icon={<UserIcon active={active === "profile"} />} />
    </View>
  );
}

function TabButton({ active, icon, label, onPress }: { active: boolean; icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.tabButton} onPress={onPress}>
      {icon}
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Input({
  icon,
  label,
  multiline,
  placeholder,
  ...props
}: {
  icon?: React.ReactNode;
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
} & Pick<TextInputProps, "autoCapitalize" | "autoCorrect" | "keyboardType" | "secureTextEntry">) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputFrame, multiline && styles.textareaFrame]}>
        {icon ? <View style={styles.inputIcon}>{icon}</View> : null}
        <TextInput
          style={[styles.input, multiline && styles.textarea]}
          placeholder={placeholder ?? label}
          placeholderTextColor="#9AA4B2"
          multiline={multiline}
          scrollEnabled={multiline}
          textAlignVertical={multiline ? "top" : "center"}
          {...props}
        />
      </View>
    </View>
  );
}

function InputLabel({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputFrame}>
        <Text style={styles.staticInputValue}>{value}</Text>
      </View>
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

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function buildRoomSections(rooms: Room[], rawQuery: string, levelFilter: string) {
  const query = rawQuery.trim().toLowerCase();
  const filteredRooms = rooms.filter((room) => {
    const matchesLevel = !levelFilter || roomLevelTitle(room) === levelFilter;
    const matchesQuery = !query || roomSearchText(room).includes(query);
    return matchesLevel && matchesQuery;
  });
  const grouped = new Map<string, Room[]>();
  for (const room of filteredRooms) {
    const level = roomLevelTitle(room);
    const existing = grouped.get(level);
    if (existing) existing.push(room);
    else grouped.set(level, [room]);
  }
  return Array.from(grouped.entries()).map<RoomSection>(([title, data]) => ({
    title,
    data: [...data].sort((firstRoom, secondRoom) => roomTitle(firstRoom).localeCompare(roomTitle(secondRoom)))
  }));
}

function roomLevelNames(rooms: Room[]) {
  return Array.from(new Set(rooms.map(roomLevelTitle))).sort((firstLevel, secondLevel) => firstLevel.localeCompare(secondLevel, "ko"));
}

function roomLevelTitle(room: Room) {
  return room.level_name?.trim() || "층 정보 없음";
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
  return `${room.room_number ?? ""} ${room.room_name ?? ""}`.trim();
}

function photoTitle(photo: Photo, rooms: Room[]) {
  const embeddedTitle = photo.room ? roomTitle(photo.room) : "";
  if (embeddedTitle) return embeddedTitle;
  const matchingRoom = rooms.find((room) => room.id === photo.room_id);
  const matchingTitle = matchingRoom ? roomTitle(matchingRoom) : "";
  if (matchingTitle) return matchingTitle;
  return photo.work_date || "사진";
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

function progressTone(room: Room, surface: SurfaceCode): PillTone {
  const progress = room.progress_by_surface?.[surface];
  if (!progress) return "gray";
  if (progress.status === "COMPLETED") return "green";
  if (progress.status === "IN_PROGRESS") return "yellow";
  return "red";
}

function surfacePhotoCount(room: Room, surface: SurfaceCode) {
  return room.progress_by_surface?.[surface]?.photo_count ?? 0;
}

function labelFor(options: readonly (readonly [string, string])[], value: string) {
  return options.find(([optionValue]) => optionValue === value)?.[1] ?? value;
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

function CameraLineIcon({ white }: { white?: boolean }) {
  return <Feather name="camera" size={white ? 56 : 30} color={white ? "#FFFFFF" : "#1669F2"} />;
}

function UploadCloudIcon() {
  return <Feather name="upload-cloud" size={30} color="#101828" />;
}

function ImageIcon() {
  return <Feather name="image" size={30} color="#64748B" />;
}

function HomeIcon({ active }: { active: boolean }) {
  return <Feather name="home" size={28} color={active ? "#1669F2" : "#667085"} />;
}

function FolderIcon({ active }: { active: boolean }) {
  return <Feather name="folder" size={28} color={active ? "#1669F2" : "#667085"} />;
}

function UserIcon({ active }: { active: boolean }) {
  return <Feather name="user" size={28} color={active ? "#1669F2" : "#667085"} />;
}

function ChevronRightIcon() {
  return <Feather name="chevron-right" size={28} color="#98A2B3" />;
}

function ChevronDownIcon() {
  return <Feather name="chevron-down" size={30} color="#475569" />;
}

function ProjectLineIcon({ active }: { active: boolean }) {
  return <Feather name="briefcase" size={28} color={active ? "#1669F2" : "#64748B"} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  keyboardRoot: { flex: 1 },
  screenContainer: { flexGrow: 1, paddingHorizontal: 24, gap: 18 },
  screenContainerCompact: { paddingHorizontal: 18, gap: 14 },
  field: { gap: 7 },
  label: { color: "#64748B", fontSize: 13, fontWeight: "800" },
  inputFrame: { minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: "#D6DEE9", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  textareaFrame: { minHeight: 168, alignItems: "flex-start", paddingTop: 14 },
  inputIcon: { width: 30, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 48, color: "#101828", fontSize: 17, padding: 0 },
  textarea: { minHeight: 140, textAlignVertical: "top" },
  staticInputValue: { color: "#101828", fontSize: 17, fontWeight: "700" },
  primaryAction: { minHeight: 62, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#1669F2", shadowColor: "#1669F2", shadowOpacity: 0.24, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  primaryActionText: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  disabledButton: { opacity: 0.48 },
  homeLayout: { gap: 16 },
  homeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  pageTitle: { color: "#101828", fontSize: 28, lineHeight: 36, fontWeight: "900" },
  pageDescription: { color: "#64748B", fontSize: 15, lineHeight: 22 },
  projectHeroCard: { minHeight: 102, borderRadius: 20, borderWidth: 1, borderColor: "#DCE6F2", backgroundColor: "#FFFFFF", padding: 16, flexDirection: "row", alignItems: "center", gap: 14 },
  projectHeroText: { flex: 1, gap: 6 },
  projectEyebrow: { color: "#1669F2", fontSize: 12, fontWeight: "900" },
  projectSelectorTitle: { color: "#101828", fontSize: 19, lineHeight: 25, fontWeight: "900" },
  projectSelectorMeta: { color: "#667085", fontSize: 15, lineHeight: 21, fontWeight: "700" },
  captureFrame: { minHeight: 360, alignItems: "center", justifyContent: "center", gap: 14 },
  cornerTopLeft: { position: "absolute", left: 0, top: 10, width: 58, height: 58, borderLeftWidth: 3, borderTopWidth: 3, borderColor: "#BDD6FF", borderTopLeftRadius: 28 },
  cornerTopRight: { position: "absolute", right: 0, top: 10, width: 58, height: 58, borderRightWidth: 3, borderTopWidth: 3, borderColor: "#BDD6FF", borderTopRightRadius: 28 },
  cornerBottomLeft: { position: "absolute", left: 0, bottom: 10, width: 58, height: 58, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: "#BDD6FF", borderBottomLeftRadius: 28 },
  cornerBottomRight: { position: "absolute", right: 0, bottom: 10, width: 58, height: 58, borderRightWidth: 3, borderBottomWidth: 3, borderColor: "#BDD6FF", borderBottomRightRadius: 28 },
  cameraCircle: { width: 160, height: 160, borderRadius: 80, backgroundColor: "#1669F2", alignItems: "center", justifyContent: "center", shadowColor: "#1669F2", shadowOpacity: 0.25, shadowRadius: 22, shadowOffset: { width: 0, height: 14 } },
  captureTitle: { color: "#101828", fontSize: 25, fontWeight: "900", textAlign: "center" },
  captureDescription: { color: "#667085", fontSize: 16, lineHeight: 24, textAlign: "center" },
  card: { borderRadius: 22, backgroundColor: "#FFFFFF", padding: 16, gap: 12, borderWidth: 1, borderColor: "#E1E8F0" },
  sectionTitle: { color: "#101828", fontSize: 19, lineHeight: 25, fontWeight: "900" },
  cardDescription: { color: "#667085", fontSize: 14, lineHeight: 21 },
  projectListItem: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: "#E2E8F0", paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  projectListItemActive: { borderColor: "#1669F2", backgroundColor: "#F0F6FF" },
  projectName: { color: "#101828", fontSize: 16, fontWeight: "900" },
  projectCode: { color: "#667085", fontSize: 13, fontWeight: "700", marginTop: 3 },
  emptyText: { color: "#667085", fontSize: 14, lineHeight: 21 },
  secondaryActionWide: { minHeight: 52, borderRadius: 16, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#1669F2", backgroundColor: "#F8FAFF" },
  secondaryActionText: { color: "#1669F2", fontWeight: "900", textAlign: "center", fontSize: 16 },
  cardHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  detailTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  backPill: { minHeight: 42, borderRadius: 999, borderWidth: 1, borderColor: "#D6DEE9", backgroundColor: "#FFFFFF", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  backPillText: { color: "#1669F2", fontSize: 14, fontWeight: "900" },
  flexOne: { flex: 1 },
  roomFilterRow: { gap: 8, paddingVertical: 2 },
  filterChip: { maxWidth: 170, borderRadius: 999, borderWidth: 1, borderColor: "#D6DEE9", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#FFFFFF" },
  filterChipActive: { borderColor: "#1669F2", backgroundColor: "#EAF3FF" },
  filterChipText: { color: "#475569", fontWeight: "800" },
  filterChipTextActive: { color: "#1669F2" },
  photoGrid: { gap: 10, paddingBottom: 112 },
  photoCard: { width: "100%", minHeight: 112, borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", overflow: "hidden", backgroundColor: "#FFFFFF", flexDirection: "row" },
  photoImage: { width: 112, minHeight: 112, backgroundColor: "#E2E8F0" },
  photoCardBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center" },
  photoTitle: { color: "#101828", fontWeight: "900", fontSize: 14 },
  photoMeta: { color: "#667085", fontSize: 12, lineHeight: 17, marginTop: 5 },
  profileCard: { borderRadius: 24, backgroundColor: "#FFFFFF", padding: 22, alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#E1E8F0" },
  avatarCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#EAF3FF", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#1669F2", fontSize: 26, fontWeight: "900" },
  profileName: { color: "#101828", fontSize: 24, fontWeight: "900" },
  profileEmail: { color: "#667085", fontSize: 14, fontWeight: "700" },
  infoLine: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderBottomWidth: 1, borderBottomColor: "#EEF2F7" },
  infoLabel: { color: "#667085", fontSize: 14, fontWeight: "800" },
  infoValue: { color: "#101828", fontSize: 15, fontWeight: "900", flex: 1, textAlign: "right" },
  logoutButton: { minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#FEE2E2" },
  logoutButtonText: { color: "#B91C1C", fontSize: 16, fontWeight: "900" },
  uploadLayout: { gap: 18 },
  uploadTopBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  uploadTitle: { color: "#101828", fontSize: 22, fontWeight: "900" },
  roundIconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  backArrow: { color: "#101828", fontSize: 40, lineHeight: 40 },
  selectBox: { minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: "#D6DEE9", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  selectValue: { color: "#101828", fontSize: 16, lineHeight: 22, fontWeight: "800" },
  selectorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selectorChip: { borderRadius: 999, borderWidth: 1, borderColor: "#D6DEE9", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#FFFFFF" },
  selectorChipActive: { borderColor: "#1669F2", backgroundColor: "#EAF3FF" },
  selectorChipText: { color: "#475569", fontWeight: "900" },
  selectorChipTextActive: { color: "#1669F2" },
  thumbnailRow: { gap: 10, paddingVertical: 2 },
  thumbnailCard: { width: 112, gap: 6 },
  thumbnailCardCompact: { width: 92, gap: 6 },
  thumbnailImage: { width: 112, height: 112, borderRadius: 16, backgroundColor: "#E2E8F0" },
  thumbnailImageCompact: { width: 92, height: 92, borderRadius: 14, backgroundColor: "#E2E8F0" },
  thumbnailRemoveButton: { minHeight: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FEE2E2" },
  thumbnailRemoveText: { color: "#B91C1C", fontSize: 12, fontWeight: "900" },
  addPhotoCard: { width: 132, height: 112, borderRadius: 16, borderWidth: 1, borderColor: "#D6DEE9", backgroundColor: "#F8FAFF", alignItems: "center", justifyContent: "center", gap: 5 },
  addPhotoCardCompact: { width: 112, height: 92, borderRadius: 16, borderWidth: 1, borderColor: "#D6DEE9", backgroundColor: "#F8FAFF", alignItems: "center", justifyContent: "center", gap: 5 },
  addPhotoText: { color: "#101828", fontSize: 14, fontWeight: "900" },
  addPhotoHint: { color: "#667085", fontSize: 12, fontWeight: "700" },
  submitPanel: { borderRadius: 20, backgroundColor: "#FFFFFF", padding: 14, gap: 12, borderWidth: 1, borderColor: "#E1E8F0" },
  uploadButton: { minHeight: 60, borderRadius: 16, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#1669F2" },
  statusBanner: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#FFFFFF", color: "#667085", fontSize: 13, lineHeight: 19, borderWidth: 1, borderColor: "#E1E8F0" },
  statusPill: { minHeight: 30, borderRadius: 999, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  statusPillText: { color: "#101828", fontSize: 12, fontWeight: "900" },
  statusPillTextMuted: { color: "#475569" },
  pillBlue: { backgroundColor: "#DBEAFE" },
  pillGreen: { backgroundColor: "#DCFCE7" },
  pillYellow: { backgroundColor: "#FEF3C7" },
  pillRed: { backgroundColor: "#FEE2E2" },
  pillGray: { backgroundColor: "#E2E8F0" },
  modalKeyboardRoot: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15, 23, 42, 0.36)" },
  modalDismissArea: { flex: 1 },
  sheetSafe: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  sheet: { height: "82%", borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: "#FFFFFF", paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12 },
  projectSheet: { height: 560, maxHeight: "78%", borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: "#FFFFFF", paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18 },
  sheetHandle: { alignSelf: "center", width: 44, height: 5, borderRadius: 999, backgroundColor: "#CBD5E1", marginBottom: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  sheetTitle: { color: "#101828", fontSize: 21, fontWeight: "900" },
  sheetSubtitle: { color: "#667085", fontSize: 13 },
  projectSheetList: { gap: 10, paddingBottom: 8 },
  projectPickerItem: { minHeight: 68, borderRadius: 18, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  projectPickerItemActive: { borderColor: "#1669F2", backgroundColor: "#F0F6FF" },
  projectPickerIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#F3F8FF", alignItems: "center", justifyContent: "center" },
  searchInput: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: "#D6DEE9", paddingHorizontal: 14, color: "#101828", backgroundColor: "#F8FAFC", marginBottom: 10 },
  levelFilterRow: { gap: 8, paddingBottom: 10 },
  sectionListContent: { paddingBottom: 26 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, paddingBottom: 7 },
  sectionHeaderText: { color: "#667085", fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  sectionHeaderCount: { color: "#94A3B8", fontSize: 12, fontWeight: "900" },
  roomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", padding: 14, marginBottom: 8, backgroundColor: "#FFFFFF" },
  roomRowActive: { borderColor: "#1669F2", backgroundColor: "#EAF3FF" },
  roomRowText: { flex: 1, gap: 2 },
  roomRowTitle: { color: "#101828", fontSize: 15, fontWeight: "900" },
  roomRowMeta: { color: "#667085", fontSize: 12, lineHeight: 18 },
  emptySheetState: { paddingVertical: 24, alignItems: "center", gap: 6 },
  emptySheetTitle: { color: "#101828", fontSize: 16, fontWeight: "900" },
  emptySheetBody: { color: "#667085", fontSize: 13, lineHeight: 19, textAlign: "center" },
  bottomTabs: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 94, paddingTop: 10, paddingBottom: 22, paddingHorizontal: 28, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#EEF2F7", flexDirection: "row", justifyContent: "space-between" },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  tabText: { color: "#667085", fontSize: 13, fontWeight: "900" },
  tabTextActive: { color: "#1669F2" },
  navIconFrame: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  navIconFrameActive: { backgroundColor: "#EAF3FF" }
});
