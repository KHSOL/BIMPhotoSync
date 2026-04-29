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
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://bimphotosync-api-production.up.railway.app/api/v1";

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
  const [email, setEmail] = useState("dev@bim.local");
  const [password, setPassword] = useState("password123");
  const [name, setName] = useState("현장 작업자");
  const [companyName, setCompanyName] = useState("BIM Photo Sync");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState("");
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [status, setStatus] = useState("로그인 후 현장 사진을 Room에 연결하세요.");
  const [uploading, setUploading] = useState(false);
  const [meta, setMeta] = useState({
    work_surface: "FLOOR",
    trade: "WATERPROOF",
    work_date: new Date().toISOString().slice(0, 10),
    worker_name: "",
    description: ""
  });

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === roomId), [roomId, rooms]);

  async function authenticate() {
    const path = authMode === "login" ? "/auth/login" : "/auth/register";
    const body =
      authMode === "login"
        ? { email, password }
        : { email, password, name, company_name: companyName, role: registerRole };
    const json = await apiJson<AuthResponse>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setToken(json.data.access_token);
    setUser(json.data.user);
    setMeta((current) => ({ ...current, worker_name: json.data.user.name }));
    setStatus(`${json.data.user.name} 계정으로 로그인했습니다.`);
    await loadProjects(json.data.access_token);
  }

  async function loadProjects(nextToken = token) {
    const json = await apiJson<{ data: Project[] }>("/projects", { headers: authHeaders(nextToken) });
    setProjects(json.data);
    const nextProjectId = json.data[0]?.id ?? "";
    setProjectId(nextProjectId);
    if (nextProjectId) await loadRooms(nextToken, nextProjectId);
  }

  async function joinProject() {
    const json = await apiJson<{ data: Project }>("/projects/join", {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ project_code: joinCode, access_key: joinKey })
    });
    setProjectId(json.data.id);
    setStatus(`${json.data.name} 프로젝트에 참여했습니다.`);
    await loadProjects();
  }

  async function loadRooms(nextToken = token, nextProjectId = projectId) {
    if (!nextProjectId) {
      setStatus("프로젝트를 먼저 선택하세요.");
      return;
    }
    const json = await apiJson<{ data: Room[] }>(`/projects/${nextProjectId}/rooms`, {
      headers: authHeaders(nextToken)
    });
    setRooms(json.data);
    setRoomId(json.data[0]?.id ?? "");
    setStatus(`${json.data.length}개 Room을 불러왔습니다.`);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("카메라 권한 필요", "현장 촬영을 위해 카메라 권한을 허용해주세요.");
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
      Alert.alert("앨범 권한 필요", "사진 선택을 위해 앨범 권한을 허용해주세요.");
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
      Alert.alert("필수값 확인", "로그인, 프로젝트, Room, 사진을 모두 선택하세요.");
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
        if (!putRes.ok) throw new Error(`Object upload failed: ${putRes.status}`);

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
      Alert.alert("업로드 완료", "사진이 Room에 연결됐습니다.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>BIM Photo Sync</Text>
            <Text style={styles.subtitle}>Room 기준 현장 사진 업로드</Text>
          </View>
          <Text style={styles.userBadge}>{user ? user.role : "Guest"}</Text>
        </View>

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
              <RoleButton label="일반" active={registerRole === "WORKER"} onPress={() => setRegisterRole("WORKER")} />
              <RoleButton label="상위 관리자" active={registerRole === "COMPANY_ADMIN"} onPress={() => setRegisterRole("COMPANY_ADMIN")} />
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
          <Pressable style={styles.primaryButton} onPress={() => authenticate().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.primaryButtonText}>{user ? `${user.name} 연결됨` : "계정 연결"}</Text>
          </Pressable>
        </Section>

        <Section title="프로젝트">
          <View style={styles.chipGrid}>
            {projects.map((project) => (
              <Pressable
                key={project.id}
                style={[styles.chip, projectId === project.id && styles.chipActive]}
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
          <Input label="프로젝트 코드" value={joinCode} onChangeText={setJoinCode} autoCapitalize="none" />
          <Input label="접근키" value={joinKey} onChangeText={setJoinKey} autoCapitalize="none" />
          <Pressable style={styles.secondaryButton} onPress={() => joinProject().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.secondaryButtonText}>접근키로 참여</Text>
          </Pressable>
        </Section>

        <Section title="촬영">
          <View style={styles.quickRow}>
            <Pressable style={styles.primaryButton} onPress={() => takePhoto().catch((err) => Alert.alert("오류", err.message))}>
              <Text style={styles.primaryButtonText}>빠른 촬영</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => pickImages().catch((err) => Alert.alert("오류", err.message))}>
              <Text style={styles.secondaryButtonText}>앨범</Text>
            </Pressable>
          </View>
        </Section>

        <Section title="사진 정보">
          <Text style={styles.label}>Room</Text>
          <View style={styles.chipGrid}>
            {rooms.map((room) => (
              <Pressable key={room.id} style={[styles.chip, roomId === room.id && styles.chipActive]} onPress={() => setRoomId(room.id)}>
                <Text style={[styles.chipText, roomId === room.id && styles.chipTextActive]}>
                  {room.room_number ?? ""} {room.room_name}
                </Text>
                <Text style={styles.caption}>{room.level_name ?? "-"} / {room.bim_photo_room_id}</Text>
              </Pressable>
            ))}
          </View>
          {selectedRoom ? <Text style={styles.caption}>선택 Room: {selectedRoom.room_name}</Text> : null}
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

        <View style={styles.footerActions}>
          <Pressable style={styles.secondaryButton} onPress={() => setStatus("임시저장은 다음 단계에서 오프라인 큐로 확장합니다.")}>
            <Text style={styles.secondaryButtonText}>임시저장</Text>
          </Pressable>
          <Pressable style={[styles.primaryButton, uploading && styles.disabledButton]} disabled={uploading} onPress={() => upload().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.primaryButtonText}>{uploading ? "업로드 중" : "업로드"}</Text>
          </Pressable>
        </View>
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

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function apiJson<T>(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message ?? json?.message ?? `API error ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }
  return json as T;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  container: { padding: 16, paddingBottom: 28 },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  logo: { fontSize: 21, color: "#0F172A", fontWeight: "800" },
  subtitle: { fontSize: 12, color: "#64748B", marginTop: 3 },
  userBadge: { color: "#2563EB", fontWeight: "800", fontSize: 12 },
  card: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginTop: 12
  },
  sectionTitle: { fontSize: 17, lineHeight: 24, color: "#0F172A", fontWeight: "800", marginBottom: 12 },
  field: { marginTop: 10 },
  label: { fontSize: 13, lineHeight: 18, color: "#334155", fontWeight: "700", marginBottom: 6 },
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
  segmented: { flexDirection: "row", marginBottom: 8 },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8,
    marginRight: 8
  },
  segmentActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  segmentText: { color: "#475569", fontWeight: "700" },
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
  quickRow: { flexDirection: "row" },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingHorizontal: 16,
    flex: 1,
    marginRight: 8
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#2563EB",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    flex: 1
  },
  secondaryButtonText: { color: "#2563EB", fontWeight: "800" },
  disabledButton: { opacity: 0.65 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  chip: {
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    maxWidth: "100%"
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
  chipText: { color: "#334155", fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: "#2563EB" },
  caption: { color: "#64748B", fontSize: 11, lineHeight: 16 },
  previewRow: { position: "relative", marginBottom: 12 },
  preview: { width: "100%", height: 190, borderRadius: 8, backgroundColor: "#E2E8F0" },
  removeButton: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center"
  },
  removeText: { color: "#334155", fontSize: 24, fontWeight: "800" },
  footerActions: { flexDirection: "row", marginTop: 14 },
  status: { marginTop: 12, color: "#64748B", fontSize: 12, lineHeight: 18 }
});
