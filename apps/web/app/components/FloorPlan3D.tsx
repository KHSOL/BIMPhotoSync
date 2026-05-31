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
  };
};

type ManagedResource =
  | import("three").BufferGeometry
  | import("three").Material
  | import("three").Texture;

const ROOM_HEIGHT_RATIO = 0.105;
const WALL_THICKNESS_RATIO = 0.0065;
const SLAB_THICKNESS_RATIO = 0.012;

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
      scene.background = new THREE.Color(0xf6f8fb);
      scene.fog = new THREE.Fog(0xf6f8fb, 900, 3400);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.className = "floor-plan-3d-canvas";
      host.appendChild(renderer.domElement);

      const bounds = plan.bounds;
      const width = Math.max(bounds.width, 1);
      const height = Math.max(bounds.height, 1);
      const maxDimension = Math.max(width, height);
      const centerX = bounds.min_x + width / 2;
      const centerY = bounds.min_y + height / 2;
      const wallHeight = Math.max(maxDimension * ROOM_HEIGHT_RATIO, 4);
      const wallThickness = Math.max(maxDimension * WALL_THICKNESS_RATIO, 0.35);
      const slabThickness = Math.max(maxDimension * SLAB_THICKNESS_RATIO, 0.7);
      const selectableMeshes: SelectableMesh[] = [];
      const managedResources: ManagedResource[] = [];
      const labelSprites: import("three").Sprite[] = [];

      addLighting(THREE, scene, centerX, centerY, maxDimension);
      addGroundPlane(THREE, scene, managedResources, centerX, centerY, width, height, maxDimension);

      if (assetUrl) {
        addPlanTexture(THREE, scene, managedResources, assetUrl, centerX, centerY, width, height, slabThickness);
      }

      for (const room of plan.rooms) {
        const status = roomProgress[room.bim_photo_room_id] ?? "not-started";
        const roomObjects = createRoomObjects(THREE, room, status, wallHeight, wallThickness, slabThickness);
        if (!roomObjects) continue;

        scene.add(roomObjects.group);
        selectableMeshes.push(...roomObjects.selectableMeshes);
        managedResources.push(...roomObjects.resources);

        const label = createRoomLabel(THREE, room, status, wallHeight + slabThickness * 1.25, maxDimension);
        if (label) {
          labelSprites.push(label.sprite);
          managedResources.push(label.texture, label.material);
          scene.add(label.sprite);
        }
      }

      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, maxDimension * 12);
      const cameraDistance = Math.max(width, height) * 1.55;
      camera.position.set(centerX - maxDimension * 0.55, centerY - cameraDistance, maxDimension * 0.82);
      camera.lookAt(centerX, centerY, wallHeight * 0.18);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(centerX, centerY, wallHeight * 0.16);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.minDistance = maxDimension * 0.28;
      controls.maxDistance = maxDimension * 4.2;
      controls.minPolarAngle = Math.PI * 0.16;
      controls.maxPolarAngle = Math.PI * 0.47;
      controls.rotateSpeed = 0.72;
      controls.zoomSpeed = 0.82;
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
            material.emissive.set(isSelected ? 0x2563eb : isHovered ? 0x0f766e : 0x000000);
            material.emissiveIntensity = isSelected ? 0.32 : isHovered ? 0.13 : 0;
            material.opacity = isSelected ? 0.98 : isHovered ? 0.95 : 0.88;
          }
          mesh.position.z = isSelected ? slabThickness * 0.22 : isHovered ? slabThickness * 0.1 : 0;
        }

        for (const sprite of labelSprites) {
          const roomId = String(sprite.userData.roomId ?? "");
          const isActive = roomId === selectedRoomIdRef.current || roomId === hoveredRoomId;
          sprite.material.opacity = isActive ? 1 : 0.78;
          const scale = isActive ? Number(sprite.userData.activeScale ?? 1) : Number(sprite.userData.baseScale ?? 1);
          sprite.scale.set(scale, scale * 0.38, 1);
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
        renderer.setSize(nextWidth, nextHeight);
        camera.aspect = nextWidth / nextHeight;
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
  const ambient = new THREE.HemisphereLight(0xffffff, 0xb8c2d8, 2.15);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.35);
  key.position.set(centerX - maxDimension * 0.85, centerY - maxDimension * 0.95, maxDimension * 1.55);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = maxDimension * 4;
  key.shadow.camera.left = -maxDimension * 1.6;
  key.shadow.camera.right = maxDimension * 1.6;
  key.shadow.camera.top = maxDimension * 1.6;
  key.shadow.camera.bottom = -maxDimension * 1.6;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xdbeafe, 0.82);
  fill.position.set(centerX + maxDimension, centerY + maxDimension * 0.25, maxDimension * 0.7);
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
  const material = new THREE.MeshStandardMaterial({
    color: 0xe5eaf2,
    roughness: 0.9,
    metalness: 0.01
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.receiveShadow = true;
  ground.position.set(centerX, centerY, -maxDimension * 0.018);
  scene.add(ground);
  resources.push(geometry, material);

  const grid = new THREE.GridHelper(maxDimension * 1.35, 18, 0xb8c2d6, 0xd8dee9);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(centerX, centerY, -maxDimension * 0.016);
  scene.add(grid);
  resources.push(grid.geometry, grid.material as import("three").Material);
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
    texture.anisotropy = 8;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.3,
      depthWrite: false
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(centerX, centerY, slabThickness * 0.11);
    plane.renderOrder = 0;
    scene.add(plane);
    resources.push(texture, geometry, material);
  });
}

function createRoomObjects(
  THREE: ThreeModule,
  room: FloorPlanRoom,
  progressStatus: RoomProgressStatus,
  wallHeight: number,
  wallThickness: number,
  slabThickness: number
) {
  if (room.polygon.length < 3) return null;

  const group = new THREE.Group();
  const resources: ManagedResource[] = [];
  const selectableMeshes: SelectableMesh[] = [];
  const color = progressColor(progressStatus);
  const edgeColor = progressEdgeColor(progressStatus);
  const shape = createRoomShape(THREE, room);
  if (!shape) return null;

  const slabGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: slabThickness,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: slabThickness * 0.18,
    bevelThickness: slabThickness * 0.12
  });
  const slabMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.02,
    transparent: true,
    opacity: 0.88
  });
  const slab = new THREE.Mesh(slabGeometry, slabMaterial) as unknown as SelectableMesh;
  slab.castShadow = true;
  slab.receiveShadow = true;
  slab.userData = { roomId: room.bim_photo_room_id, selectable: true, progressStatus };
  group.add(slab);
  selectableMeshes.push(slab);
  resources.push(slabGeometry, slabMaterial);

  const lineMaterial = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.74 });
  for (let index = 0; index < room.polygon.length; index += 1) {
    const start = room.polygon[index];
    const end = room.polygon[(index + 1) % room.polygon.length];
    const wall = createWallMesh(THREE, start, end, wallHeight, wallThickness, color, room.bim_photo_room_id, progressStatus);
    if (wall) {
      group.add(wall.mesh);
      selectableMeshes.push(wall.mesh);
      resources.push(wall.geometry, wall.material);
    }

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start.x, start.y, wallHeight + slabThickness * 1.35),
      new THREE.Vector3(end.x, end.y, wallHeight + slabThickness * 1.35)
    ]);
    const line = new THREE.Line(lineGeometry, lineMaterial);
    group.add(line);
    resources.push(lineGeometry);
  }
  resources.push(lineMaterial);

  return { group, resources, selectableMeshes };
}

function createRoomShape(THREE: ThreeModule, room: FloorPlanRoom) {
  if (room.polygon.length < 3) return null;
  const shape = new THREE.Shape();
  room.polygon.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  return shape;
}

function createWallMesh(
  THREE: ThreeModule,
  start: { x: number; y: number },
  end: { x: number; y: number },
  wallHeight: number,
  wallThickness: number,
  color: number,
  roomId: string,
  progressStatus: RoomProgressStatus
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0.001) return null;

  const geometry = new THREE.BoxGeometry(length, wallThickness, wallHeight);
  const material = new THREE.MeshStandardMaterial({
    color: lightenColor(color, 0.18),
    roughness: 0.82,
    metalness: 0.02,
    transparent: true,
    opacity: 0.88
  });
  const mesh = new THREE.Mesh(geometry, material) as unknown as SelectableMesh;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, wallHeight / 2);
  mesh.rotation.z = Math.atan2(dy, dx);
  mesh.userData = { roomId, selectable: true, progressStatus };
  return { mesh, geometry, material };
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
  context.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(context, 28, 38, 456, 92, 28);
  context.fill();
  context.strokeStyle = status === "completed" ? "#16a34a" : status === "in-progress" ? "#d97706" : "#dc2626";
  context.lineWidth = 10;
  context.stroke();
  context.fillStyle = "#0f172a";
  context.font = "700 42px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.slice(0, 18), 256, 84, 400);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.78, depthTest: false });
  const sprite = new THREE.Sprite(material);
  const baseScale = Math.max(maxDimension * 0.085, 7);
  sprite.scale.set(baseScale, baseScale * 0.38, 1);
  sprite.position.set(room.center.x, room.center.y, z);
  sprite.renderOrder = 4;
  sprite.userData = { roomId: room.bim_photo_room_id, baseScale, activeScale: baseScale * 1.16 };
  return { sprite, texture, material };
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
  if (status === "completed") return 0x22c55e;
  if (status === "in-progress") return 0xf59e0b;
  return 0xef4444;
}

function progressEdgeColor(status: RoomProgressStatus) {
  if (status === "completed") return 0x15803d;
  if (status === "in-progress") return 0xb45309;
  return 0xb91c1c;
}

function lightenColor(color: number, amount: number) {
  const red = Math.min(255, Math.round(((color >> 16) & 255) + 255 * amount));
  const green = Math.min(255, Math.round(((color >> 8) & 255) + 255 * amount));
  const blue = Math.min(255, Math.round((color & 255) + 255 * amount));
  return (red << 16) + (green << 8) + blue;
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
