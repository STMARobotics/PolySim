import * as THREE from 'three';
import type {PieceDefinition} from '../contracts/field';

export function pieceGeometry(piece:PieceDefinition):THREE.BufferGeometry {
 if(piece.shape==='sphere')return new THREE.SphereGeometry(piece.radius,48,32);
 if(piece.shape==='box')return new THREE.BoxGeometry(...piece.size);
 const inner=piece.innerRadius!,outer=piece.size[1]/2,half=piece.size[0]/2;
 const geometry=new THREE.LatheGeometry([new THREE.Vector2(inner,-half),new THREE.Vector2(outer,-half),new THREE.Vector2(outer,half),new THREE.Vector2(inner,half),new THREE.Vector2(inner,-half)],64);
 geometry.rotateZ(-Math.PI/2);return geometry;
}
