"use client";

import { Box3, Color, DirectionalLight, GridHelper, HemisphereLight, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { useEffect, useRef, useState } from "react";
import { authHeaders } from "../client";

export function ObjModelViewer({
  assetUrl,
  token,
  label
}: {
  assetUrl: string;
  token: string;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !assetUrl || !token) return;

    let disposed = false;
    let frame = 0;
    const scene = new Scene();
    scene.background = new Color(0xf8fafc);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.className = "obj-model-canvas";
    host.appendChild(renderer.domElement);

    const camera = new PerspectiveCamera(42, Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight), 0.1, 100000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    const hemi = new HemisphereLight(0xffffff, 0xcbd5e1, 2.2);
    scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 1.8);
    key.position.set(-30, 60, 80);
    scene.add(key);
    const fill = new DirectionalLight(0xe0f2fe, 0.8);
    fill.position.set(70, -40, 45);
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

    async function loadModel() {
      setState("loading");
      try {
        const response = await fetch(assetUrl, { headers: authHeaders(token) });
        if (!response.ok) throw new Error(`OBJ asset ${response.status}`);
        const text = await response.text();
        if (disposed) return;

        const object = new OBJLoader().parse(text);
        object.traverse((child) => {
          if (child instanceof Mesh && child.material && !Array.isArray(child.material)) {
            child.material.color?.set?.(0xe5e7eb);
            child.material.transparent = false;
            child.material.needsUpdate = true;
          }
        });
        scene.add(object);

        const bounds = new Box3().setFromObject(object);
        const size = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 1);
        object.position.sub(center);

        const grid = new GridHelper(maxDimension * 1.35, 24, 0x94a3b8, 0xe2e8f0);
        grid.position.y = bounds.min.y - center.y;
        scene.add(grid);

        camera.position.set(maxDimension * 0.75, maxDimension * 0.62, maxDimension * 0.82);
        controls.target.set(0, 0, 0);
        controls.minDistance = maxDimension * 0.05;
        controls.maxDistance = maxDimension * 3;
        controls.update();
        setState("ready");
      } catch {
        if (!disposed) setState("error");
      }
    }

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    void loadModel();
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((child) => {
        if (child instanceof Mesh) {
          child.geometry?.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [assetUrl, token]);

  return (
    <div className="obj-model-viewer" ref={hostRef} aria-label={label}>
      {state === "loading" ? <div className="model-viewer-status">3D 모델을 불러오는 중입니다.</div> : null}
      {state === "error" ? <div className="model-viewer-status error">3D 모델을 표시하지 못했습니다.</div> : null}
    </div>
  );
}
