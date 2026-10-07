import * as THREE from 'three';

const MAX_SPARKS = 600;
const DEBRIS_POOL = 24;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // Sparks
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    this.sparkBase = new Float32Array(MAX_SPARKS * 3);
    this.sparkNext = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.03,
        map: makeDotTexture(),
        alphaTest: 0.01,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);

    // Debris halves (clipped clones of the note body)
    this.debris = [];
    for (let i = 0; i < DEBRIS_POOL; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.4,
        metalness: 0.1,
        side: THREE.DoubleSide,
        transparent: true,
        clippingPlanes: [new THREE.Plane()],
      });
      const mesh = new THREE.Mesh(undefined, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.debris.push({ mesh, mat, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), localPlane: new THREE.Plane() });
    }
    this.debrisNext = 0;
  }

  spawnSparks(pos, color, count = 40, speed = 3, dirHint = null) {
    for (let i = 0; i < count; i++) {
      const k = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % MAX_SPARKS;
      this.sparkPos[k * 3] = pos.x;
      this.sparkPos[k * 3 + 1] = pos.y;
      this.sparkPos[k * 3 + 2] = pos.z;
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (dirHint) _v.addScaledVector(dirHint, 0.8);
      _v.multiplyScalar(speed * (0.3 + Math.random()));
      this.sparkVel[k * 3] = _v.x;
      this.sparkVel[k * 3 + 1] = _v.y;
      this.sparkVel[k * 3 + 2] = _v.z;
      this.sparkLife[k] = 0.4 + Math.random() * 0.5;
      this.sparkBase[k * 3] = Math.min(1, color.r + 0.4);
      this.sparkBase[k * 3 + 1] = Math.min(1, color.g + 0.4);
      this.sparkBase[k * 3 + 2] = Math.min(1, color.b + 0.4);
    }
  }

  /**
   * Splits a note into two clipped halves flying apart.
   * noteObj: the note's body mesh (world matrix used), cutNormal: world-space plane normal through the note centre.
   */
  spawnDebris(bodyMesh, color, center, cutNormal, cutDir, noteVel) {
    for (let side = -1; side <= 1; side += 2) {
      const d = this.debris[this.debrisNext];
      this.debrisNext = (this.debrisNext + 1) % DEBRIS_POOL;
      const mesh = d.mesh;
      mesh.geometry = bodyMesh.geometry;
      bodyMesh.updateWorldMatrix(true, false);
      bodyMesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrixWorld(true);
      d.mat.color.copy(color);
      d.mat.opacity = 1;
      // plane in mesh-local space: keep the half on `side` of the cut normal
      _n.copy(cutNormal).multiplyScalar(-side);
      const inv = mesh.matrixWorld.clone().invert();
      const localNormal = _n.clone().applyMatrix3(_m3.getNormalMatrix(inv)).normalize();
      d.localPlane.set(localNormal, 0);
      d.vel.copy(noteVel).multiplyScalar(0.05).addScaledVector(cutNormal, side * 1.6).addScaledVector(cutDir, 1.0);
      d.vel.y += 0.8;
      d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
      d.life = 0.55;
      mesh.visible = true;
    }
  }

  update(dt) {
    // Sparks
    for (let k = 0; k < MAX_SPARKS; k++) {
      if (this.sparkLife[k] <= 0) continue;
      this.sparkLife[k] -= dt;
      const l = Math.max(0, this.sparkLife[k]);
      this.sparkVel[k * 3 + 1] -= 6 * dt;
      this.sparkPos[k * 3] += this.sparkVel[k * 3] * dt;
      this.sparkPos[k * 3 + 1] += this.sparkVel[k * 3 + 1] * dt;
      this.sparkPos[k * 3 + 2] += this.sparkVel[k * 3 + 2] * dt;
      const f = Math.min(1, l * 2);
      this.sparkCol[k * 3] = this.sparkBase[k * 3] * f;
      this.sparkCol[k * 3 + 1] = this.sparkBase[k * 3 + 1] * f;
      this.sparkCol[k * 3 + 2] = this.sparkBase[k * 3 + 2] * f;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;

    // Debris
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const m = d.mesh;
      if (d.life <= 0) {
        m.visible = false;
        continue;
      }
      d.vel.y -= 9.8 * dt;
      m.position.addScaledVector(d.vel, dt);
      m.rotation.x += d.spin.x * dt;
      m.rotation.y += d.spin.y * dt;
      m.rotation.z += d.spin.z * dt;
      m.scale.multiplyScalar(1 - dt * 1.6);
      d.mat.opacity = Math.min(1, d.life * 2.5);
      m.updateMatrixWorld(true);
      d.mat.clippingPlanes[0].copy(d.localPlane).applyMatrix4(m.matrixWorld);
    }
  }

  clear() {
    this.sparkLife.fill(0);
    this.sparkCol.fill(0);
    for (const d of this.debris) {
      d.life = 0;
      d.mesh.visible = false;
    }
  }
}
