"use client";

import { useEffect, useMemo, useRef } from "react";
import type { FloorPlanRoom, RevitFloorPlan, Room } from "../client";

type RoomProgressStatus = "not-started" | "in-progress" | "completed";

type ThreeRoomMesh = import("three").Mesh & {
  material: import("three").MeshStandardMaterial;
  userData: {
    roomId: string;
  };
};

export function FloorPlan3D({
  plan,
  selectedRoomId,
  roomProgressByBimId,
  onSelect
}: {
  plan: RevitFloorPlan;
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
      scene.background = new THREE.Color(0xf8fafc);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.className = "floor-plan-3d-canvas";
      host.appendChild(renderer.domElement);

      const bounds = plan.bounds;
      const width = Math.max(bounds.width, 1);
      const height = Math.max(bounds.height, 1);
      const maxDimension = Math.max(width, height);
      const centerX = bounds.min_x + width / 2;
      const centerY = bounds.min_y + height / 2;
      const roomHeight = maxDimension * 0.035;
      const roomMeshes: ThreeRoomMesh[] = [];
      const selectedEmissive = new THREE.Color(0x1d4ed8);
      const defaultEmissive = new THREE.Color(0x000000);

      const ambient = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 2.2);
      scene.add(ambient);
      const directional = new THREE.DirectionalLight(0xffffff, 1.9);
      directional.position.set(centerX - maxDimension, centerY - maxDimension, maxDimension);
      scene.add(directional);

      const floorGeometry = new THREE.BoxGeometry(width * 1.04, height * 1.04, roomHeight * 0.18);
      const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.82, metalness: 0.02 });
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.position.set(centerX, centerY, -roomHeight * 0.14);
      scene.add(floor);

      for (const room of plan.rooms) {
        const mesh = createRoomMesh(THREE, room, roomProgress[room.bim_photo_room_id], roomHeight);
        if (!mesh) continue;
        roomMeshes.push(mesh);
        scene.add(mesh);
      }

      const camera = new THREE.OrthographicCamera(-width * 0.72, width * 0.72, height * 0.72, -height * 0.72, 0.1, maxDimension * 10);
      camera.position.set(centerX, centerY - maxDimension * 1.2, maxDimension * 1.05);
      camera.lookAt(centerX, centerY, 0);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(centerX, centerY, 0);
      controls.enableDamping = true;
      controls.enablePan = true;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.minZoom = 0.65;
      controls.maxZoom = 4;
      controls.update();

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();

      const updateSelection = () => {
        for (const mesh of roomMeshes) {
          const material = mesh.material;
          const isSelected = mesh.userData.roomId === selectedRoomIdRef.current;
          material.emissive.copy(isSelected ? selectedEmissive : defaultEmissive);
          material.emissiveIntensity = isSelected ? 0.18 : 0;
        }
      };

      const onPointerDown = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(roomMeshes, false)[0]?.object as ThreeRoomMesh | undefined;
        if (hit?.userData.roomId) onSelectRef.current(hit.userData.roomId);
      };
      renderer.domElement.addEventListener("pointerdown", onPointerDown);

      const resize = () => {
        const nextWidth = Math.max(1, host.clientWidth);
        const nextHeight = Math.max(1, host.clientHeight);
        renderer.setSize(nextWidth, nextHeight);
        const aspect = nextWidth / nextHeight;
        camera.left = -width * 0.72 * Math.max(1, aspect);
        camera.right = width * 0.72 * Math.max(1, aspect);
        camera.top = height * 0.72;
        camera.bottom = -height * 0.72;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      let frame = 0;
      const animate = () => {
        frame = window.requestAnimationFrame(animate);
        controls.update();
        updateSelection();
        renderer.render(scene, camera);
      };
      animate();

      cleanup = () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        controls.dispose();
        for (const mesh of roomMeshes) {
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
          else mesh.material.dispose();
        }
        floorGeometry.dispose();
        floorMaterial.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }

    void mount();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [plan, roomProgress]);

  return <div className="floor-plan-3d" ref={hostRef} />;
}

function createRoomMesh(
  THREE: typeof import("three"),
  room: FloorPlanRoom,
  progressStatus: RoomProgressStatus,
  roomHeight: number
): ThreeRoomMesh | null {
  if (room.polygon.length < 3) return null;
  const shape = new THREE.Shape();
  room.polygon.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: roomHeight, bevelEnabled: false });
  const color = progressColor(progressStatus);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.02,
    transparent: true,
    opacity: 0.92
  });
  const mesh = new THREE.Mesh(geometry, material) as unknown as ThreeRoomMesh;
  mesh.userData.roomId = room.bim_photo_room_id;
  return mesh;
}

function progressColor(status: RoomProgressStatus) {
  if (status === "completed") return 0x22c55e;
  if (status === "in-progress") return 0xf59e0b;
  return 0xef4444;
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
