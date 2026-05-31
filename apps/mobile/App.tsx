import React, { useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api-production-1d018.up.railway.app/api/v1";

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
  progress_by_surface?: Record<string, { status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"; photo_count: number }>;
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

export default function App() {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [registerRole, setRegisterRole] = useState<"WORKER" | "COMPANY_ADMIN">("WORKER");
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
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [status, setStatus] = useState("로그인 후 프로젝트를 선택하면 현장 사진을 바로 올릴 수 있습니다.");
  const [uploading, setUploading] = useState(false);
  const [meta, setMeta] = useState({
    work_surface: "WALL",
    trade: "OTHER",
    work_date: new Date().toISOString().slice(0, 10),
    worker_name: "",
    description: ""
  });

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projectId, projects]);
  const selectedRoom = useMemo(() => rooms.find((room) => room.id === roomId), [roomId, rooms]);
  const readyToUpload = Boolean(token && projectId && roomId && images.length > 0 && !uploading);

  async function authenticate() {
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
    setMeta((current) => ({ ...current, worker_name: json.data.user.name }));
    setStatus(`${json.data.user.name} 계정으로 연결되었습니다.`);
    await loadProjects(json.data.access_token);
  }

  async function loadProjects(nextToken = token) {
    const json = await apiJson<{ data: Project[] }>("/projects", { headers: authHeaders(nextToken) });
    const nextProjects = Array.isArray(json.data) ? json.data : [];
    setProjects(nextProjects);
    const nextProjectId = nextProjects[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) await loadRooms(nextToken, nextProjectId);
    else setStatus("참여 중인 프로젝트가 없습니다. 접근키로 프로젝트에 참여하세요.");
  }

  async function previewJoinProject() {
    const accessKey = joinKey.trim();
    if (!token) {
      Alert.alert("로그인 필요", "프로젝트 참여 전 먼저 로그인하세요.");
      return;
    }
    if (!accessKey) {
      Alert.alert("접근키 필요", "관리자가 공유한 프로젝트 접근키를 입력하세요.");
      return;
    }

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
          joinProject(accessKey).catch((err) => Alert.alert("오류", err.message));
        }
      }
    ]);
  }

  async function joinProject(accessKey = joinKey.trim()) {
    const json = await apiJson<{ data: Project }>("/projects/join", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: accessKey })
    });
    setJoinKey("");
    setProjectId(json.data.id);
    setStatus(`${json.data.name} 프로젝트에 참여했습니다.`);
    await loadProjects();
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) {
      setRooms([]);
      setRoomId("");
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }

    const json = await apiJson<{ data: Room[] }>(`/projects/${nextProjectId}/rooms`, {
      headers: authHeaders(nextToken)
    });
    const nextRooms = Array.isArray(json.data) ? json.data : [];
    setRooms(nextRooms);
    setRoomId(nextRooms[0]?.id ?? "");
    setStatus(`${nextRooms.length}개 방을 불러왔습니다.`);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("카메라 권한 필요", "현장 촬영을 위해 카메라 권한을 허용하세요.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85
    });
    if (!result.canceled) setImages((current) => [...current, result.assets[0]]);
  }

  async function pickImages() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("앨범 권한 필요", "사진 선택을 위해 앨범 권한을 허용하세요.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85
    });
    if (!result.canceled) setImages((current) => [...current, ...result.assets]);
  }

  async function upload() {
    if (!token || !projectId || !roomId || images.length === 0) {
      Alert.alert("업로드 준비 필요", "로그인, 프로젝트, 방, 사진을 모두 선택하세요.");
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

        const putRes = await fetch(presign.data.presigned_url, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: blob
        });
        if (!putRes.ok) throw new Error(`파일 업로드 실패: ${putRes.status}`);

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
      setStatus("사진 업로드가 완료됐고 AI 분석 큐에 등록됐습니다.");
      Alert.alert("업로드 완료", "사진이 선택한 방에 연결되었습니다.");
      await loadRooms();
    } finally {
      setUploading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>B</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.logo}>BIM Photo Sync</Text>
            <Text style={styles.subtitle}>현장 사진 업로드</Text>
          </View>
          <Text style={styles.userBadge}>{user ? roleLabel(user.role) : "로그인 전"}</Text>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>사진 촬영부터 업로드까지</Text>
          <Text style={styles.heroMeta}>
            {selectedProject ? selectedProject.name : "프로젝트 미선택"} · {selectedRoom ? roomTitle(selectedRoom) : "방 미선택"}
          </Text>
          <View style={styles.quickRow}>
            <Pressable style={styles.primaryButton} onPress={() => takePhoto().catch((err) => Alert.alert("오류", err.message))}>
              <Text style={styles.primaryButtonText}>바로 촬영</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => pickImages().catch((err) => Alert.alert("오류", err.message))}>
              <Text style={styles.secondaryButtonText}>앨범 선택</Text>
            </Pressable>
          </View>
          <View style={styles.uploadStatusRow}>
            <StatusPill label={`${images.length}장`} tone={images.length > 0 ? "blue" : "gray"} />
            <StatusPill label={selectedRoom ? roomProgressLabel(selectedRoom) : "방 선택 필요"} tone={selectedRoom ? progressTone(selectedRoom) : "gray"} />
          </View>
          <Pressable
            style={[styles.uploadButton, !readyToUpload && styles.disabledButton]}
            disabled={!readyToUpload}
            onPress={() => upload().catch((err) => Alert.alert("오류", err.message))}
          >
            <Text style={styles.primaryButtonText}>{uploading ? "업로드 중" : "선택한 방에 업로드"}</Text>
          </Pressable>
        </View>

        <Section title="방 선택">
          {rooms.length === 0 ? <Text style={styles.caption}>로그인 후 프로젝트에 참여하면 방 목록이 표시됩니다.</Text> : null}
          <View style={styles.roomGrid}>
            {rooms.map((room) => (
              <Pressable key={room.id} style={[styles.roomChip, roomId === room.id && styles.roomChipActive]} onPress={() => setRoomId(room.id)}>
                <View style={styles.chipTitleRow}>
                  <View style={[styles.statusDot, progressDotStyle(room)]} />
                  <Text style={[styles.roomName, roomId === room.id && styles.chipTextActive]} numberOfLines={1}>
                    {roomTitle(room)}
                  </Text>
                </View>
                <Text style={styles.caption}>{room.level_name ?? "-"} · {roomProgressLabel(room)}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="사진 정보">
          <Selector label="공사면" value={meta.work_surface} values={surfaces} onChange={(work_surface) => setMeta({ ...meta, work_surface })} />
          <Selector label="공종" value={meta.trade} values={trades} onChange={(trade) => setMeta({ ...meta, trade })} />
          <Input label="작업일자" value={meta.work_date} onChangeText={(work_date) => setMeta({ ...meta, work_date })} />
          <Input label="작성자" value={meta.worker_name} onChangeText={(worker_name) => setMeta({ ...meta, worker_name })} />
          <Input label="내용" value={meta.description} onChangeText={(description) => setMeta({ ...meta, description })} multiline />
        </Section>

        <Section title="사진 미리보기">
          {images.length === 0 ? <Text style={styles.caption}>선택된 사진이 없습니다.</Text> : null}
          {images.map((image, index) => (
            <View key={`${image.uri}-${index}`} style={styles.previewRow}>
              <Image source={{ uri: image.uri }} style={styles.preview} />
              <Pressable style={styles.removeButton} onPress={() => setImages((current) => current.filter((_, i) => i !== index))}>
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          ))}
        </Section>

        <Section title="계정">
          <View style={styles.segmented}>
            <Pressable style={[styles.segment, authMode === "login" && styles.segmentActive]} onPress={() => setAuthMode("login")}>
              <Text style={[styles.segmentText, authMode === "login" && styles.segmentTextActive]}>로그인</Text>
            </Pressable>
            <Pressable style={[styles.segment, authMode === "register" && styles.segmentActive]} onPress={() => setAuthMode("register")}>
              <Text style={[styles.segmentText, authMode === "register" && styles.segmentTextActive]}>회원가입</Text>
            </Pressable>
          </View>
          {authMode === "register" ? (
            <View style={styles.roleRow}>
              <RoleButton label="작업자" active={registerRole === "WORKER"} onPress={() => setRegisterRole("WORKER")} />
              <RoleButton label="관리자" active={registerRole === "COMPANY_ADMIN"} onPress={() => setRegisterRole("COMPANY_ADMIN")} />
            </View>
          ) : null}
          <Input label="이메일" value={email} onChangeText={setEmail} autoCapitalize="none" />
          <Input label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry />
          {authMode === "register" ? (
            <>
              <Input label="이름" value={name} onChangeText={setName} />
              <Input label="회사명" value={companyName} onChangeText={setCompanyName} />
            </>
          ) : null}
          <Pressable style={styles.primaryButtonWide} onPress={() => authenticate().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.primaryButtonText}>{user ? `${user.name} 연결됨` : "계정 연결"}</Text>
          </Pressable>
        </Section>

        <Section title="프로젝트">
          <View style={styles.projectList}>
            {projects.map((project) => (
              <Pressable
                key={project.id}
                style={[styles.projectChip, projectId === project.id && styles.chipActive]}
                onPress={() => {
                  setProjectId(project.id);
                  loadRooms(token, project.id).catch((err) => Alert.alert("오류", err.message));
                }}
              >
                <Text style={[styles.chipText, projectId === project.id && styles.chipTextActive]}>{project.name}</Text>
                <Text style={styles.caption}>{project.code}</Text>
              </Pressable>
            ))}
          </View>
          <Input label="프로젝트 접근키" value={joinKey} onChangeText={setJoinKey} autoCapitalize="none" />
          <Pressable style={styles.secondaryButtonWide} onPress={() => previewJoinProject().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.secondaryButtonText}>프로젝트 확인 및 참여</Text>
          </Pressable>
        </Section>

        <Text style={styles.status}>{status}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
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

function RoleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.roleButton, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Input(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput style={[styles.input, props.multiline && styles.textarea]} placeholder={props.label} {...props} />
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
      <View style={styles.chipGrid}>
        {props.values.map(([value, label]) => (
          <Pressable key={value} style={[styles.smallChip, props.value === value && styles.chipActive]} onPress={() => props.onChange(value)}>
            <Text style={[styles.chipText, props.value === value && styles.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
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

function roomProgressLabel(room: Room) {
  const wall = room.progress_by_surface?.WALL;
  if (wall?.status === "COMPLETED") return "완료";
  if (wall?.status === "IN_PROGRESS") return "진행 중";
  return "시작 전";
}

function progressTone(room: Room): "green" | "yellow" | "red" {
  const wall = room.progress_by_surface?.WALL;
  if (wall?.status === "COMPLETED") return "green";
  if (wall?.status === "IN_PROGRESS") return "yellow";
  return "red";
}

function progressDotStyle(room: Room) {
  const tone = progressTone(room);
  if (tone === "green") return styles.statusDone;
  if (tone === "yellow") return styles.statusDoing;
  return styles.statusTodo;
}

function authHeaders(nextToken: string) {
  return { Authorization: `Bearer ${nextToken}` };
}

async function apiJson<T>(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = getApiErrorMessage(json) ?? `API error ${res.status}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function capitalize(value: "blue" | "green" | "yellow" | "red" | "gray") {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` as "Blue" | "Green" | "Yellow" | "Red" | "Gray";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FB" },
  container: { padding: 16, paddingBottom: 30 },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", marginBottom: 10 },
  logoMark: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    marginRight: 10
  },
  logoMarkText: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  headerText: { flex: 1 },
  logo: { fontSize: 21, color: "#0F172A", fontWeight: "900" },
  subtitle: { fontSize: 12, color: "#64748B", marginTop: 3 },
  userBadge: { color: "#2563EB", fontWeight: "800", fontSize: 12 },
  heroCard: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    padding: 16,
    marginTop: 6
  },
  heroTitle: { color: "#FFFFFF", fontSize: 21, lineHeight: 28, fontWeight: "900" },
  heroMeta: { color: "#CBD5E1", fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 14 },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginTop: 12
  },
  sectionTitle: { fontSize: 17, lineHeight: 24, color: "#0F172A", fontWeight: "900", marginBottom: 12 },
  field: { marginTop: 10 },
  label: { fontSize: 13, lineHeight: 18, color: "#334155", fontWeight: "800", marginBottom: 6 },
  input: {
    minHeight: 48,
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: "#0F172A",
    backgroundColor: "#FFFFFF"
  },
  textarea: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  segmented: { flexDirection: "row", marginBottom: 8, gap: 8 },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8
  },
  segmentActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  segmentText: { color: "#475569", fontWeight: "800" },
  segmentTextActive: { color: "#2563EB" },
  roleRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  roleButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8
  },
  quickRow: { flexDirection: "row", gap: 8 },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingHorizontal: 16,
    flex: 1
  },
  primaryButtonWide: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingHorizontal: 16,
    marginTop: 12
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  secondaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#93C5FD",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    flex: 1,
    backgroundColor: "#FFFFFF"
  },
  secondaryButtonWide: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#2563EB",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginTop: 12,
    backgroundColor: "#FFFFFF"
  },
  secondaryButtonText: { color: "#2563EB", fontWeight: "900" },
  disabledButton: { opacity: 0.55 },
  uploadButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16A34A",
    borderRadius: 8,
    paddingHorizontal: 16,
    marginTop: 12
  },
  uploadStatusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  statusPill: { minHeight: 28, borderRadius: 999, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  statusPillText: { fontSize: 12, fontWeight: "900", color: "#0F172A" },
  statusPillTextMuted: { color: "#475569" },
  pillBlue: { backgroundColor: "#DBEAFE" },
  pillGreen: { backgroundColor: "#DCFCE7" },
  pillYellow: { backgroundColor: "#FEF3C7" },
  pillRed: { backgroundColor: "#FEE2E2" },
  pillGray: { backgroundColor: "#E2E8F0" },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  roomGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roomChip: {
    width: "48%",
    minHeight: 72,
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#FFFFFF"
  },
  roomChipActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  projectList: { gap: 8 },
  projectChip: {
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#FFFFFF"
  },
  smallChip: {
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginRight: 7,
    marginBottom: 7
  },
  chipActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  chipTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  chipText: { color: "#334155", fontSize: 13, fontWeight: "800" },
  roomName: { color: "#334155", fontSize: 13, fontWeight: "900", flex: 1 },
  chipTextActive: { color: "#2563EB" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTodo: { backgroundColor: "#DC2626" },
  statusDoing: { backgroundColor: "#EAB308" },
  statusDone: { backgroundColor: "#16A34A" },
  caption: { color: "#64748B", fontSize: 11, lineHeight: 16 },
  previewRow: { position: "relative", marginBottom: 12 },
  preview: { width: "100%", height: 200, borderRadius: 8, backgroundColor: "#E2E8F0" },
  removeButton: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center"
  },
  removeText: { color: "#334155", fontSize: 24, fontWeight: "900" },
  status: { marginTop: 12, color: "#64748B", fontSize: 12, lineHeight: 18 }
});
