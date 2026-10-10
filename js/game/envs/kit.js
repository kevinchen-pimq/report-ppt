// Building blocks for environment modules (js/game/envs/<EnvironmentName>.js).
// See js/game/envs/CONTRACT.md for what a module returns.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _black = new THREE.Color(0, 0, 0);

/** Material for emissive light shapes: additive, so a light set to black is invisible. */
export function lightMaterial({ opacity = 1, additive = true } = {}) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: additive || opacity < 1,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    toneMapped: false,
    fog: false,
  });
}

/**
 * Many lights sharing one geometry and material = one draw call.
 * Each light is an instance with its own colour (set by the lighting runtime).
 */
export class LightBank {
  constructor(parent, geometry, max, { material = lightMaterial(), renderOrder = 0 } = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _black); // creates instanceColor
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
    this.max = max;
    this.dirtyColor = true;
    this.dirtyMatrix = true;
    this.lights = [];
  }

  /** Adds a light with a local matrix (relative to the bank's parent). Returns the Light. */
  add(matrix) {
    if (this.mesh.count >= this.max) throw new Error('LightBank full');
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, _black);
    const light = new Light(this, i);
    this.lights.push(light);
    this.dirtyMatrix = true;
    return light;
  }

  /** Moves a light (e.g. a laser beam that rotates on its own). */
  setMatrix(i, matrix) {
    this.mesh.setMatrixAt(i, matrix);
    this.dirtyMatrix = true;
  }

  /** Upload changes; the runtime calls this once per frame. */
  update() {
    if (this.dirtyColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.dirtyColor = false;
    }
    if (this.dirtyMatrix) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.computeBoundingSphere?.();
      this.dirtyMatrix = false;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose?.();
  }
}

/** One addressable light. The runtime calls set(r, g, b) with linear RGB already scaled by brightness. */
export class Light {
  constructor(bank, index) {
    this.bank = bank;
    this.index = index;
    this.r = 0;
    this.g = 0;
    this.b = 0;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    const a = this.bank.mesh.instanceColor.array;
    a[this.index * 3] = r;
    a[this.index * 3 + 1] = g;
    a[this.index * 3 + 2] = b;
    this.bank.dirtyColor = true;
  }
}

/**
 * A light that is its own Object3D (for lights that must move independently, e.g. rotating
 * lasers parented to a pivot). Prefer LightBank when possible (fewer draw calls).
 */
export class MeshLight {
  constructor(mesh) {
    this.mesh = mesh;
    this.r = this.g = this.b = -1;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    this.mesh.material.color.setRGB(r, g, b);
    this.mesh.visible = r + g + b > 0.002;
  }
}

/** Matrix for a unit cylinder (radius 1, height 1, along Y, centred) stretched from a to b. */
export function tubeMatrix(a, b, radius, out = new THREE.Matrix4()) {
  _d.subVectors(b, a);
  const len = _d.length();
  _p.addVectors(a, b).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, _d.normalize());
  _s.set(radius, len, radius);
  return out.compose(_p, _q, _s);
}

/** Matrix from position, Euler rotation (radians) and scale. */
export function trs(position, rotation = [0, 0, 0], scale = [1, 1, 1], out = new THREE.Matrix4()) {
  _p.set(position[0], position[1], position[2]);
  _q.setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
  _s.set(scale[0], scale[1], scale[2]);
  return out.compose(_p, _q, _s);
}

/** Shared unit geometries for light shapes. */
export const GEO = {
  tube: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  disc: new THREE.CircleGeometry(1, 24),
};

/** Merges static meshes (same material) into one mesh = one draw call. */
export function mergeStatic(meshes, material) {
  const parts = meshes.map((m) => {
    m.updateMatrix();
    return m.geometry.clone().applyMatrix4(m.matrix);
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Standard dark scenery materials (lit by the scene's ambient light). */
export function sceneryMaterials() {
  return {
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0c14, roughness: 0.6, metalness: 0.4 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.35, metalness: 0.8 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x090a12, roughness: 0.25, metalness: 0.6 }),
  };
}
