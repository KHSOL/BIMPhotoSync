"use client";

import { useEffect, useMemo, useRef } from "react";
import type { FloorPlanRoom, RevitFloorPlan, Room } from "../client";

type RoomProgressStatus = "not-started" | "in-progress" | "completed";
type ThreeModule = typeof import("three");

type SelectableMesh = import("three").Mesh & {
  material: import("three").MeshStandardMaterial | import("three").MeshStandardMaterial[];
  userData: {
    roomId: string;
    selectable: true;
    progressStatus: RoomProgressStatus;
    elementKind: "floor";
  };
};

type ManagedResource =
  | import("three").BufferGeometry
  | import("three").Material
  | import("three").Texture;

const SLAB_THICKNESS_RATIO = 0.004;
const WALL_EDGE_COLOR = 0x334155;

export function FloorPlan3D({
  plan,
  assetUrl,
  selectedRoomId,
  roomProgressByBimId,
  onSelect
}: {
  plan: RevitFloorPlan;
  assetUrl: string;
  selectedRoomId: string;
  roomProgressByBimId: Record<string, Room["progress_by_surface"]>;
  onSelect: (roomId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const selectedRoomIdRef = useRef(selectedRoomId);
  const onSelectRef = useRef(onSelect);

  const roomProgress = useMemo(
    () =>
      plan.rooms.reduce<Record<string, RoomProgressStatus>>((result, room) => {
        result[room.bim_photo_room_id] = roomDisplayProgress(roomProgressByBimId[room.bim_photo_room_id]);
        return result;
      }, {}),
    [plan.rooms, roomProgressByBimId]
  );

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
    onSelectRef.current = onSelect;
  }, [onSelect, selectedRoomId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function mount() {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed || !host) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.shadowMap.enabled = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.className = "floor-plan-3d-canvas";
      host.appendChild(renderer.domElement);

      const bounds = plan.bounds;
      const width = Math.max(bounds.width, 1);
      const height = Math.max(bounds.height, 1);
      const maxDimension = Math.max(width, height);
      const centerX = bounds.min_x + width / 2;
      const centerY = bounds.min_y + height / 2;
      const outlineHeight = Math.max(maxDimension * 0.018, 0.8);
      const slabThickness = Math.max(maxDimension * SLAB_THICKNESS_RATIO, 0.18);
      const selectableMeshes: SelectableMesh[] = [];
      const managedResources: ManagedResource[] = [];
      const labelPlanes: import("three").Mesh<import("three").PlaneGeometry, import("three").MeshBasicMaterial>[] = [];

      addLighting(THREE, scene, centerX, centerY, maxDimension);
      addGroundPlane(THREE, scene, managedResources, centerX, centerY, width, height, maxDimension);

      if (assetUrl) {
        addPlanTexture(THREE, scene, managedResources, assetUrl, centerX, centerY, width, height, slabThickness);
      }

      for (const room of plan.rooms) {
        const status = roomProgress[room.bim_photo_room_id] ?? "not-started";
        const roomObjects = createRoomObjects(THREE, room, status, outlineHeight, slabThickness);
        if (!roomObjects) continue;

        scene.add(roomObjects.group);
        selectableMeshes.push(...roomObjects.selectableMeshes);
        managedResources.push(...roomObjects.resources);

        const label = createRoomLabel(THREE, room, status, slabThickness * 1.55, maxDimension);
        if (label) {
          labelPlanes.push(label.mesh);
          managedResources.push(label.geometry, label.texture, label.material);
          scene.add(label.mesh);
        }
      }

      const viewSize = maxDimension * 1.18;
      const camera = new THREE.OrthographicCamera(-viewSize / 2, viewSize / 2, viewSize / 2, -viewSize / 2, -maxDimension * 4, maxDimension * 8);
      camera.up.set(0, 0, 1);
      camera.position.set(centerX - maxDimension * 0.58, centerY - maxDimension * 0.72, maxDimension * 1.12);
      camera.zoom = 1.2;
      camera.lookAt(centerX, centerY, outlineHeight * 0.18);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(centerX, centerY, outlineHeight * 0.18);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.minZoom = 0.78;
      controls.maxZoom = 3.2;
      controls.minPolarAngle = Math.PI * 0.2;
      controls.maxPolarAngle = Math.PI * 0.42;
      controls.rotateSpeed = 0.52;
      controls.zoomSpeed = 0.72;
      controls.panSpeed = 0.78;
      controls.update();

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let hoveredRoomId = "";

      const applySelection = () => {
        for (const mesh of selectableMeshes) {
          const roomId = mesh.userData.roomId;
          const isSelected = roomId === selectedRoomIdRef.current;
          const isHovered = roomId === hoveredRoomId;
          const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as import("three").MeshStandardMaterial[];

          for (const material of materials) {
            material.color.set(isSelected ? 0xbfdbfe : isHovered ? 0xccfbf1 : progressColor(mesh.userData.progressStatus));
            material.emissive.set(isSelected ? 0x2563eb : isHovered ? 0x0f766e : 0x000000);
            material.emissiveIntensity = isSelected ? 0.18 : isHovered ? 0.08 : 0;
            material.opacity = isSelected ? 0.42 : isHovered ? 0.28 : 0.13;
          }
          mesh.position.z = isSelected ? slabThickness * 0.22 : isHovered ? slabThickness * 0.1 : 0;
        }

        for (const label of labelPlanes) {
          const roomId = String(label.userData.roomId ?? "");
          const isActive = roomId === selectedRoomIdRef.current || roomId === hoveredRoomId;
          label.visible = isActive;
          const material = label.material as import("three").MeshBasicMaterial;
          material.opacity = isActive ? 0.94 : 0;
        }
      };

      const pickRoom = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects(selectableMeshes, false)[0]?.object as SelectableMesh | undefined;
      };

      const onPointerMove = (event: PointerEvent) => {
        const hit = pickRoom(event);
        hoveredRoomId = hit?.userData.roomId ?? "";
        renderer.domElement.style.cursor = hoveredRoomId ? "pointer" : "grab";
      };

      const onPointerLeave = () => {
        hoveredRoomId = "";
        renderer.domElement.style.cursor = "grab";
      };

      const onPointerDown = (event: PointerEvent) => {
        const hit = pickRoom(event);
        if (hit?.userData.roomId) onSelectRef.current(hit.userData.roomId);
      };

      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerleave", onPointerLeave);
      renderer.domElement.addEventListener("pointerdown", onPointerDown);

      const resize = () => {
        const nextWidth = Math.max(1, host.clientWidth);
        const nextHeight = Math.max(1, host.clientHeight);
        const aspect = nextWidth / nextHeight;
        renderer.setSize(nextWidth, nextHeight);
        camera.left = (-viewSize * aspect) / 2;
        camera.right = (viewSize * aspect) / 2;
        camera.top = viewSize / 2;
        camera.bottom = -viewSize / 2;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      let frame = 0;
      const animate = () => {
        frame = window.requestAnimationFrame(animate);
        controls.update();
        applySelection();
        renderer.render(scene, camera);
      };
      animate();

      cleanup = () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        controls.dispose();
        for (const resource of managedResources) resource.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }

    void mount();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [assetUrl, plan, roomProgress]);

  return (
    <div className="floor-plan-3d" ref={hostRef}>
      <div className="floor-plan-3d-hud" aria-hidden="true">
        <span className="legend-dot legend-red" />
        <span>시작 전</span>
        <span className="legend-dot legend-yellow" />
        <span>진행 중</span>
        <span className="legend-dot legend-green" />
        <span>완료</span>
      </div>
    </div>
  );
}

function addLighting(
  THREE: ThreeModule,
  scene: import("three").Scene,
  centerX: number,
  centerY: number,
  maxDimension: number
) {
  const ambient = new THREE.HemisphereLight(0xffffff, 0xd8dee9, 2.35);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(centerX - maxDimension * 0.45, centerY - maxDimension * 0.55, maxDimension * 1.2);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xe0f2fe, 0.6);
  fill.position.set(centerX + maxDimension * 0.7, centerY + maxDimension * 0.4, maxDimension * 0.8);
  scene.add(fill);
}

function addGroundPlane(
  THREE: ThreeModule,
  scene: import("three").Scene,
  resources: ManagedResource[],
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  maxDimension: number
) {
  const geometry = new THREE.PlaneGeometry(width * 1.22, height * 1.22);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.position.set(centerX, centerY, -maxDimension * 0.014);
  scene.add(ground);
  resources.push(geometry, material);
}

function addPlanTexture(
  THREE: ThreeModule,
  scene: import("three").Scene,
  resources: ManagedResource[],
  assetUrl: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  slabThickness: number
) {
  const loader = new THREE.TextureLoader();
  loader.load(assetUrl, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 12;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.58,
      depthWrite: false
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(centerX, centerY, slabThickness * 0.04);
    plane.renderOrder = 0;
    scene.add(plane);
    resources.push(texture, geometry, material);
  });
}

function createRoomObjects(
  THREE: ThreeModule,
  room: FloorPlanRoom,
  progressStatus: RoomProgressStatus,
  outlineHeight: number,
  slabThickness: number
) {
  if (room.polygon.length < 3) return null;

  const group = new THREE.Group();
  const resources: ManagedResource[] = [];
  const selectableMeshes: SelectableMesh[] = [];
  const color = progressColor(progressStatus);
  const polygon = simplifyPolygon(room.polygon, 0.04);
  const shape = createRoomShape(THREE, polygon);
  if (!shape) return null;

  const slabGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: slabThickness,
    bevelEnabled: false
  });
  const slabMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.18
  });
  const slab = new THREE.Mesh(slabGeometry, slabMaterial) as unknown as SelectableMesh;
  slab.castShadow = false;
  slab.receiveShadow = false;
  slab.userData = { roomId: room.bim_photo_room_id, selectable: true, progressStatus, elementKind: "floor" };
  group.add(slab);
  selectableMeshes.push(slab);
  resources.push(slabGeometry, slabMaterial);

  const lineMaterial = new THREE.LineBasicMaterial({ color: WALL_EDGE_COLOR, transparent: true, opacity: 0.62 });
  const ghostLineMaterial = new THREE.LineBasicMaterial({ color: WALL_EDGE_COLOR, transparent: true, opacity: 0.18 });
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start.x, start.y, slabThickness * 1.35),
      new THREE.Vector3(end.x, end.y, slabThickness * 1.35)
    ]);
    const line = new THREE.Line(lineGeometry, lineMaterial);
    group.add(line);

    const raisedLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start.x, start.y, outlineHeight),
      new THREE.Vector3(end.x, end.y, outlineHeight)
    ]);
    const raisedLine = new THREE.Line(raisedLineGeometry, ghostLineMaterial);
    group.add(raisedLine);
    resources.push(lineGeometry, raisedLineGeometry);
  }
  resources.push(lineMaterial, ghostLineMaterial);

  return { group, resources, selectableMeshes };
}

function createRoomShape(THREE: ThreeModule, polygon: FloorPlanRoom["polygon"]) {
  if (polygon.length < 3) return null;
  const shape = new THREE.Shape();
  polygon.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  return shape;
}

function createRoomLabel(
  THREE: ThreeModule,
  room: FloorPlanRoom,
  status: RoomProgressStatus,
  z: number,
  maxDimension: number
) {
  const text = `${room.room_number ?? ""} ${room.room_name}`.trim();
  if (!text) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,0.9)";
  roundRect(context, 72, 58, 368, 76, 16);
  context.fill();
  context.strokeStyle = status === "completed" ? "#22c55e" : status === "in-progress" ? "#f59e0b" : "#ef4444";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#111827";
  context.font = "700 30px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.slice(0, 18), 256, 96, 324);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.58,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const roomArea = room.area_m2 ?? polygonArea(room.polygon);
  const areaScale = Math.sqrt(Math.max(roomArea, 1));
  const labelWidth = Math.min(Math.max(areaScale * 0.58, maxDimension * 0.052), maxDimension * 0.14);
  const labelHeight = labelWidth * 0.375;
  const geometry = new THREE.PlaneGeometry(labelWidth, labelHeight);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(room.center.x, room.center.y, z);
  mesh.visible = false;
  mesh.renderOrder = 5;
  mesh.userData = {
    roomId: room.bim_photo_room_id
  };
  return { mesh, geometry, texture, material };
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function progressColor(status: RoomProgressStatus) {
  if (status === "completed") return 0xbbf7d0;
  if (status === "in-progress") return 0xfde68a;
  return 0xfecaca;
}

function polygonArea(polygon: FloorPlanRoom["polygon"]) {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function simplifyPolygon(polygon: FloorPlanRoom["polygon"], epsilon: number): FloorPlanRoom["polygon"] {
  if (polygon.length < 4) return polygon;

  const withoutShortSegments = polygon.filter((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > epsilon;
  });
  const candidates = withoutShortSegments.length >= 3 ? withoutShortSegments : polygon;

  return candidates.filter((point, index) => {
    const previous = candidates[(index + candidates.length - 1) % candidates.length];
    const next = candidates[(index + 1) % candidates.length];
    const ax = point.x - previous.x;
    const ay = point.y - previous.y;
    const bx = next.x - point.x;
    const by = next.y - point.y;
    const cross = Math.abs(ax * by - ay * bx);
    const length = Math.hypot(ax, ay) + Math.hypot(bx, by);
    return length <= 0.001 || cross / length > epsilon * 0.24;
  });
}

function roomDisplayProgress(progress: Room["progress_by_surface"] | undefined): RoomProgressStatus {
  const wall = progress?.WALL;
  if (wall?.status === "COMPLETED") return "completed";
  if (wall?.status === "IN_PROGRESS") return "in-progress";
  const values = Object.values(progress ?? {});
  if (values.some((item) => item.status === "COMPLETED")) return "completed";
  if (values.some((item) => item.status === "IN_PROGRESS")) return "in-progress";
  return "not-started";
}
