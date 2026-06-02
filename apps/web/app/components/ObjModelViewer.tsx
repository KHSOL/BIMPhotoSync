"use client";

import {
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { useEffect, useRef, useState } from "react";
import { authHeaders, type FloorPlanRoom, type RevitFloorPlan, type Room } from "../client";

type RoomProgressStatus = "not-started" | "in-progress" | "completed";

type SelectableRoomMesh = Mesh<ShapeGeometry, MeshStandardMaterial> & {
  userData: {
    selectableRoom: true;
    roomId: string;
    progressStatus: RoomProgressStatus;
  };
};

type DisposableResource = BufferGeometry | MeshStandardMaterial | LineBasicMaterial;

export function ObjModelViewer({
  assetUrl,
  token,
  label,
  plan,
  selectedRoomId,
  roomProgressByBimId,
  onSelect
}: {
  assetUrl: string;
  token: string;
  label: string;
  plan?: RevitFloorPlan;
  selectedRoomId?: string;
  roomProgressByBimId?: Record<string, Room["progress_by_surface"]>;
  onSelect?: (roomId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const selectedRoomIdRef = useRef(selectedRoomId ?? "");
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId ?? "";
    onSelectRef.current = onSelect;
  }, [onSelect, selectedRoomId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !assetUrl || !token) return;

    let disposed = false;
    let frame = 0;
    let hoveredRoomId = "";
    const roomMeshes: SelectableRoomMesh[] = [];
    const disposables: DisposableResource[] = [];
    const scene = new Scene();
    scene.background = new Color(0xffffff);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.className = "obj-model-canvas";
    host.appendChild(renderer.domElement);

    const camera = new PerspectiveCamera(34, Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight), 0.1, 100000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.rotateSpeed = 0.48;
    controls.zoomSpeed = 0.7;
    controls.panSpeed = 0.72;

    const hemi = new HemisphereLight(0xffffff, 0xdbeafe, 2.4);
    scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(-60, 80, 90);
    scene.add(key);
    const fill = new DirectionalLight(0xe0f2fe, 1.1);
    fill.position.set(80, -50, 50);
    scene.add(fill);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const pickRoom = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(roomMeshes, false)[0]?.object as SelectableRoomMesh | undefined;
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
      if (hit?.userData.roomId) onSelectRef.current?.(hit.userData.roomId);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    async function loadModel() {
      setState("loading");
      try {
        const response = await fetch(assetUrl, { headers: authHeaders(token) });
        if (!response.ok) throw new Error(`OBJ asset ${response.status}`);
        const text = await response.text();
        if (disposed) return;

        const object = new OBJLoader().parse(text);
        object.traverse((child) => {
          if (child instanceof Mesh) {
            const material = new MeshStandardMaterial({
              color: 0xf8fafc,
              roughness: 0.72,
              metalness: 0.02,
              transparent: true,
              opacity: 0.84,
              side: DoubleSide
            });
            child.material = material;
            disposables.push(material);
          }
        });

        const rawBounds = new Box3().setFromObject(object);
        const rawSize = rawBounds.getSize(new Vector3());
        hideDetachedDetailMeshes(object, rawBounds, rawSize);
        const bounds = visibleMeshBounds(object);
        const size = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 1);
        object.position.set(-center.x, -bounds.min.y, -center.z);
        scene.add(object);

        addModelEdges(object, disposables, maxDimension);
        if (plan) {
          const roomGroup = createRoomOverlay(plan, center, maxDimension, roomProgressByBimId ?? {}, roomMeshes, disposables);
          scene.add(roomGroup);
        }

        const grid = new GridHelper(maxDimension * 1.2, 24, 0xcbd5e1, 0xeef2ff);
        grid.position.y = -maxDimension * 0.006;
        scene.add(grid);

        camera.position.set(maxDimension * 0.64, maxDimension * 0.58, maxDimension * 0.78);
        controls.target.set(0, size.y * 0.18, 0);
        controls.minDistance = maxDimension * 0.05;
        controls.maxDistance = maxDimension * 2.5;
        controls.update();
        setState("ready");
      } catch {
        if (!disposed) setState("error");
      }
    }

    const applySelection = () => {
      for (const mesh of roomMeshes) {
        const isSelected = mesh.userData.roomId === selectedRoomIdRef.current;
        const isHovered = mesh.userData.roomId === hoveredRoomId;
        mesh.material.color.set(isSelected ? 0xbfdbfe : isHovered ? 0xccfbf1 : progressColor(mesh.userData.progressStatus));
        mesh.material.opacity = isSelected ? 0.5 : isHovered ? 0.38 : 0.22;
        mesh.material.emissive.set(isSelected ? 0x2563eb : isHovered ? 0x0f766e : 0x000000);
        mesh.material.emissiveIntensity = isSelected ? 0.16 : isHovered ? 0.08 : 0;
      }
    };

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      controls.update();
      applySelection();
      renderer.render(scene, camera);
    };
    void loadModel();
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      observer.disconnect();
      controls.dispose();
      scene.traverse((child) => {
        if (child instanceof Mesh) {
          child.geometry?.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) material.dispose();
        }
      });
      for (const resource of disposables) resource.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [assetUrl, plan, roomProgressByBimId, token]);

  return (
    <div className="obj-model-viewer" ref={hostRef} aria-label={label}>
      {state === "loading" ? <div className="model-viewer-status">3D 모델을 불러오는 중입니다.</div> : null}
      {state === "error" ? <div className="model-viewer-status error">3D 모델을 표시하지 못했습니다.</div> : null}
    </div>
  );
}

function addModelEdges(object: Group, disposables: DisposableResource[], maxDimension: number) {
  object.traverse((child) => {
    if (!(child instanceof Mesh) || !child.visible) return;
    const childBounds = new Box3().setFromObject(child);
    const childSize = childBounds.getSize(new Vector3());
    if (shouldSkipEdgeMesh(childSize, maxDimension)) return;

    const geometry = new EdgesGeometry(child.geometry, 55);
    const material = new LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.3 });
    const edges = new LineSegments(geometry, material);
    edges.renderOrder = 3;
    child.add(edges);
    disposables.push(geometry, material);
  });
}

function hideDetachedDetailMeshes(object: Group, modelBounds: Box3, modelSize: Vector3) {
  const modelMaxDimension = Math.max(modelSize.x, modelSize.y, modelSize.z, 1);
  const horizontalSpan = Math.max(modelSize.x, modelSize.z, 1);
  const floorY = modelBounds.min.y;
  const modelHeight = Math.max(modelSize.y, 1);

  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const bounds = new Box3().setFromObject(child);
    if (bounds.isEmpty()) return;

    const size = bounds.getSize(new Vector3());
    const maxSide = Math.max(size.x, size.y, size.z);
    const minSide = Math.min(size.x, size.y, size.z);
    const center = bounds.getCenter(new Vector3());
    const highDetachedSmallPart =
      center.y > floorY + modelHeight * 0.42 &&
      maxSide < horizontalSpan * 0.09 &&
      size.y < modelHeight * 0.22;
    const tinyPart = maxSide < modelMaxDimension * 0.012;
    const flatFloatingPart =
      minSide < modelMaxDimension * 0.0015 &&
      maxSide < horizontalSpan * 0.075 &&
      center.y > floorY + modelHeight * 0.22;

    if (highDetachedSmallPart || tinyPart || flatFloatingPart) {
      child.visible = false;
    }
  });
}

function visibleMeshBounds(object: Group) {
  const bounds = new Box3();
  let hasVisibleMesh = false;
  object.traverse((child) => {
    if (!(child instanceof Mesh) || !child.visible) return;
    const childBounds = new Box3().setFromObject(child);
    if (childBounds.isEmpty()) return;
    bounds.union(childBounds);
    hasVisibleMesh = true;
  });
  return hasVisibleMesh ? bounds : new Box3().setFromObject(object);
}

function shouldSkipEdgeMesh(size: Vector3, maxDimension: number) {
  const maxSide = Math.max(size.x, size.y, size.z);
  const minSide = Math.min(size.x, size.y, size.z);
  return maxSide < maxDimension * 0.018 || (minSide < maxDimension * 0.0008 && maxSide < maxDimension * 0.08);
}

function createRoomOverlay(
  plan: RevitFloorPlan,
  center: Vector3,
  maxDimension: number,
  roomProgressByBimId: Record<string, Room["progress_by_surface"]>,
  roomMeshes: SelectableRoomMesh[],
  disposables: DisposableResource[]
) {
  const group = new Group();
  const overlayY = maxDimension * 0.014;

  for (const room of plan.rooms) {
    const shape = createRoomShape(room);
    if (!shape) continue;

    const status = roomDisplayProgress(roomProgressByBimId[room.bim_photo_room_id]);
    const geometry = new ShapeGeometry(shape);
    const material = new MeshStandardMaterial({
      color: progressColor(status),
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.22,
      side: DoubleSide,
      depthTest: false
    });
    const mesh = new Mesh(geometry, material) as SelectableRoomMesh;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(-center.x, overlayY, center.z);
    mesh.renderOrder = 10;
    mesh.userData = {
      selectableRoom: true,
      roomId: room.bim_photo_room_id,
      progressStatus: status
    };
    group.add(mesh);
    roomMeshes.push(mesh);
    disposables.push(geometry, material);
  }

  return group;
}

function createRoomShape(room: FloorPlanRoom) {
  const polygon = room.polygon.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (polygon.length < 3) return null;

  const shape = new Shape();
  shape.moveTo(polygon[0].x, -polygon[0].y);
  for (const point of polygon.slice(1)) {
    shape.lineTo(point.x, -point.y);
  }
  shape.closePath();
  return shape;
}

function roomDisplayProgress(progress: Room["progress_by_surface"] | undefined): RoomProgressStatus {
  const wall = progress?.WALL;
  if (wall?.status === "COMPLETED") return "completed";
  if (wall?.status === "IN_PROGRESS" || (wall?.photo_count ?? 0) > 0) return "in-progress";
  return "not-started";
}

function progressColor(status: RoomProgressStatus) {
  if (status === "completed") return 0x22c55e;
  if (status === "in-progress") return 0xf59e0b;
  return 0xef4444;
}
