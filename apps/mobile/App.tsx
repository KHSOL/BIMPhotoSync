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

const trades = ["WATERPROOF", "TILE", "PAINT", "ELECTRIC", "MEP", "WINDOW", "CONCRETE", "OTHER"];
const surfaces = ["FLOOR", "WALL", "CEILING", "WINDOW", "DOOR", "PIPE", "ELECTRIC", "OTHER"];

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

export default function App() {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
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
        : { email, password, name, company_name: companyName };
    const json = await apiJson<{ data: { access_token: string; user: User } }>(path, {
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
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.logo}>BIM Photo Sync</Text>
          <Text style={styles.clock}>09:41</Text>
        </View>

        <Section title="로그인">
          <View style={styles.segmented}>
            <Pressable style={[styles.segment, authMode === "login" && styles.segmentActive]} onPress={() => setAuthMode("login")}>
              <Text style={[styles.segmentText, authMode === "login" && styles.segmentTextActive]}>로그인</Text>
            </Pressable>
            <Pressable style={[styles.segment, authMode === "register" && styles.segmentActive]} onPress={() => setAuthMode("register")}>
              <Text style={[styles.segmentText, authMode === "register" && styles.segmentTextActive]}>가입</Text>
            </Pressable>
          </View>
          <Input label="Email" value={email} onChangeText={setEmail} />
          <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {authMode === "register" ? (
            <>
              <Input label="Name" value={name} onChangeText={setName} />
              <Input label="Company" value={companyName} onChangeText={setCompanyName} />
            </>
          ) : null}
          <Pressable style={styles.primaryButton} onPress={() => authenticate().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.primaryButtonText}>{user ? `${user.name} / ${user.role}` : "계정 연결"}</Text>
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
          <Input label="Project Code" value={joinCode} onChangeText={setJoinCode} />
          <Input label="Access Key" value={joinKey} onChangeText={setJoinKey} />
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

        <Section title="메타데이터">
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
          <Selector label="Surface" value={meta.work_surface} values={surfaces} onChange={(work_surface) => setMeta({ ...meta, work_surface })} />
          <Selector label="Trade" value={meta.trade} values={trades} onChange={(trade) => setMeta({ ...meta, trade })} />
          <Input label="Work Date" value={meta.work_date} onChangeText={(work_date) => setMeta({ ...meta, work_date })} />
          <Input label="Worker" value={meta.worker_name} onChangeText={(worker_name) => setMeta({ ...meta, worker_name })} />
          <Input label="내용" value={meta.description} onChangeText={(description) => setMeta({ ...meta, description })} multiline />
        </Section>

        <Section title="사진 미리보기">
          {images.length === 0 ? <Text style={styles.caption}>선택된 사진이 없습니다.</Text> : null}
          {images.map((image, index) => (
            <View key={`${image.uri}-${index}`} style={styles.previewRow}>
              <Image source={{ uri: image.uri }} style={styles.preview} />
              <Pressable style={styles.removeButton} onPress={() => setImages((current) => current.filter((_, i) => i !== index))}>
                <Text style={styles.removeText}>X</Text>
              </Pressable>
            </View>
          ))}
        </Section>

        <View style={styles.footerActions}>
          <Pressable style={styles.secondaryButton} onPress={() => setStatus("임시저장은 다음 단계에서 오프라인 큐로 확장합니다.")}>
            <Text style={styles.secondaryButtonText}>임시저장</Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={() => upload().catch((err) => Alert.alert("오류", err.message))}>
            <Text style={styles.primaryButtonText}>업로드</Text>
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

function Input(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput style={[styles.input, props.multiline && styles.textarea]} placeholder={props.label} {...props} />
    </View>
  );
}

function Selector(props: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.chipGrid}>
        {props.values.map((value) => (
          <Pressable key={value} style={[styles.smallChip, props.value === value && styles.chipActive]} onPress={() => props.onChange(value)}>
            <Text style={[styles.chipText, props.value === value && styles.chipTextActive]}>{value}</Text>
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
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  logo: { fontSize: 20, color: "#0F172A", fontWeight: "800" },
  clock: { fontSize: 16, color: "#334155", fontWeight: "700" },
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
    minHeight: 46,
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
  quickRow: { flexDirection: "row" },
  primaryButton: {
    minHeight: 46,
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
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#2563EB",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    flex: 1
  },
  secondaryButtonText: { color: "#2563EB", fontWeight: "800" },
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
  removeText: { color: "#334155", fontSize: 18, fontWeight: "800" },
  footerActions: { flexDirection: "row", marginTop: 14 },
  status: { marginTop: 12, color: "#64748B", fontSize: 12, lineHeight: 18 }
});
