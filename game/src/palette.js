// RUSTLINE palette — rust amber + slate teal on concrete grey, dusk yard.
import * as THREE from 'three';

export const PAL = {
  ember: 0xff9a3c,
  emberDeep: 0xc25e10,
  slate: 0x37b6ab,
  slateDeep: 0x0e6b64,
  concrete: 0x878d93,
  concreteDark: 0x565b61,
  asphalt: 0x3c4046,
  rust: 0x9c4a1e,
  sand: 0xc9a06a,
  dusk: 0x2c3542,
  fog: 0x39424f,
  sun: 0xffb36b,
  white: 0xf2ede4,
  black: 0x0c0e10,
  wood: 0x7a5a38,
  hazard: 0xd8a013,
};

// Same colours as '#rrggbb' strings for HUD / DOM use.
export const CSS = Object.fromEntries(
  Object.entries(PAL).map(([k, v]) => [k, '#' + v.toString(16).padStart(6, '0')]),
);

// Cheap shared Lambert material. Callers should cache the result, not call
// this per frame — Lambert is unlit-cheap and fine for a dusk yard.
export function mat(color, rough = 0.9, metal = 0.0) {
  return new THREE.MeshLambertMaterial({ color, roughness: rough, metalness: metal });
}
