// 佔位世界 (placeholder) —— 之後會被正式的場景取代。
//
// 介面：
//   export const ARENA_RADIUS = 20;
//   export function createWorld(scene) -> { update(dt, t), setTheme(floorNumber) }

import * as THREE from 'three';

export const ARENA_RADIUS = 20;

const THEMES = [
  // [天頂色, 地平線色, 霧色]
  [0x1b3a6b, 0x9fd4ff, 0x9fc4dd],
  [0x2a1f4f, 0xd8a0ff, 0xb59ad0],
  [0x3a1a14, 0xffb07a, 0xd09a80],
  [0x0e2c2a, 0x8fffe0, 0x88c8b8],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);

  // 天空：漸層球
  const skyUniforms = {
    topColor: { value: new THREE.Color(THEMES[0][0]) },
    bottomColor: { value: new THREE.Color(THEMES[0][1]) },
    offset: { value: 20 },
    exponent: { value: 0.6 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.name = 'sky';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  scene.fog = new THREE.Fog(THEMES[0][2], 30, 140);

  // 燈光
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a3f46, 1.1);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(12, 25, 8);
  group.add(sun);

  // 地面：灰色圓盤
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS, 64),
    new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  group.add(ground);

  // 邊界環 + 網格，方便判斷移動
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ARENA_RADIUS - 0.15, ARENA_RADIUS, 96),
    new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.8 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  group.add(ring);

  const grid = new THREE.PolarGridHelper(ARENA_RADIUS, 16, 8, 64, 0x6d737a, 0x6d737a);
  grid.position.y = 0.005;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  group.add(grid);

  // 外圍的大地面 (遠方)，避免世界邊緣是空洞
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(ARENA_RADIUS, 400, 64),
    new THREE.MeshStandardMaterial({ color: 0x5d636a, roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  group.add(outer);

  function setTheme(floorNumber = 1) {
    const th = THEMES[(Math.max(1, floorNumber) - 1) % THEMES.length];
    skyUniforms.topColor.value.setHex(th[0]);
    skyUniforms.bottomColor.value.setHex(th[1]);
    scene.fog.color.setHex(th[2]);
  }

  return {
    group,
    update(dt, t) {
      ring.material.opacity = 0.55 + 0.25 * Math.sin(t * 2);
    },
    setTheme,
  };
}
