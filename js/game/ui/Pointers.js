import * as THREE from 'three';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _quat = new THREE.Quaternion();
const _meshes = [];
const _hits = [];

/**
 * Laser pointers for UI panels: one per XR controller (target-ray space),
 * plus the desktop mouse.
 */
export class Pointers {
  constructor(game) {
    this.game = game;
    this.lasers = [];
    this.cursors = [];
    this.hits = [null, null, null]; // 0,1 = controllers, 2 = mouse
    this.lastScroll = [0, 0];
    const laserGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 6, 1, true);
    laserGeo.rotateX(-Math.PI / 2);
    laserGeo.translate(0, 0, -0.5);
    const cursorGeo = new THREE.RingGeometry(0.008, 0.018, 20);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      const laser = new THREE.Mesh(laserGeo, mat);
      laser.visible = false;
      laser.renderOrder = 40;
      game.renderer.xr.getController(i).add(laser);
      this.lasers.push(laser);
      const cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
      cursor.renderOrder = 50;
      cursor.visible = false;
      game.scene.add(cursor);
      this.cursors.push(cursor);
    }
  }

  hideAll(panels) {
    for (let i = 0; i < 2; i++) {
      this.lasers[i].visible = false;
      this.cursors[i].visible = false;
    }
    for (let i = 0; i < 3; i++) this.clearHover(i, panels);
  }

  clearHover(i, panels) {
    for (const p of panels) p.setHover(i, null);
    this.hits[i] = null;
  }

  pick(panels) {
    _meshes.length = 0;
    for (const p of panels) if (p.mesh.visible) _meshes.push(p.mesh);
    if (!_meshes.length) return null;
    _hits.length = 0;
    const hit = _ray.intersectObjects(_meshes, false, _hits)[0];
    _hits.length = 0;
    if (!hit || !hit.uv) return null;
    // the raycaster creates fresh point / uv vectors for every intersection: no need to copy them
    return { panel: hit.object.userData.panel, uv: hit.uv, point: hit.point, distance: hit.distance };
  }

  /** XR controllers; call each frame while menus are shown. */
  updateXR(panels) {
    const game = this.game;
    for (let i = 0; i < 2; i++) {
      const input = game.xrInputs[i];
      const ctrl = game.renderer.xr.getController(i);
      const laser = this.lasers[i];
      const cursor = this.cursors[i];
      if (!input || !ctrl.visible || input.targetRayMode === 'gaze') {
        laser.visible = false;
        cursor.visible = false;
        this.clearHover(i, panels);
        continue;
      }
      ctrl.updateMatrixWorld(true);
      _origin.setFromMatrixPosition(ctrl.matrixWorld);
      _dir.set(0, 0, -1).transformDirection(ctrl.matrixWorld);
      _ray.set(_origin, _dir);
      const hit = this.pick(panels);
      laser.visible = true;
      if (hit) {
        laser.scale.set(1, 1, hit.distance);
        cursor.visible = true;
        cursor.position.copy(hit.point);
        cursor.quaternion.copy(hit.panel.mesh.getWorldQuaternion(_quat));
        cursor.translateZ(0.005);
        for (const p of panels) if (p !== hit.panel) p.setHover(i, null);
        hit.panel.setHover(i, hit.panel.hitAt(hit.uv)?.id ?? null);
        this.hits[i] = hit;
        // thumbstick scrolling
        const gp = input.gamepad;
        const ay = gp ? (gp.axes[3] ?? gp.axes[1] ?? 0) : 0;
        const now = performance.now();
        if (Math.abs(ay) > 0.6 && now - this.lastScroll[i] > 180) {
          this.lastScroll[i] = now;
          hit.panel.scroll(hit.uv, ay > 0 ? 1 : -1);
        }
      } else {
        laser.scale.set(1, 1, 3);
        cursor.visible = false;
        this.clearHover(i, panels);
      }
    }
  }

  /** Desktop mouse (NDC coordinates). */
  updateMouse(panels, ndc, camera) {
    _ray.setFromCamera(ndc, camera);
    const hit = this.pick(panels);
    if (hit) {
      for (const p of panels) if (p !== hit.panel) p.setHover(2, null);
      hit.panel.setHover(2, hit.panel.hitAt(hit.uv)?.id ?? null);
      this.hits[2] = hit;
    } else this.clearHover(2, panels);
    return !!hit;
  }

  /** Click with pointer i; returns true if a widget handled it. */
  click(i) {
    const hit = this.hits[i];
    if (!hit) return false;
    return hit.panel.click(hit.uv);
  }

  /** Mouse wheel / thumbstick scrolling for pointer i. */
  scroll(i, dir) {
    const hit = this.hits[i];
    if (hit) hit.panel.scroll(hit.uv, dir);
  }
}
