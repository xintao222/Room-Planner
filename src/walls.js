'use strict';

import _ from 'lodash';
import * as THREE from 'three';
import {LineGeometry} from "three/examples/jsm/lines/LineGeometry";
import {LineMaterial} from "three/examples/jsm/lines/LineMaterial";
import {Line2} from "three/examples/jsm/lines/Line2";
import Graph from "graph.js/dist/graph.es6";
import {setTexture, skirtingMaterial} from "./materials";
import {hide} from "./view";
import {scene} from "./app";
import {loadJson, saveJson} from "./loader";
import {addText} from "./draw";

let inside = require("point-in-polygon");

export const DEPTH = 0.05;
export const HEIGHT = 1.3;

export let floorPlan;
export let drawModel, floorModel, wallsModel, skirtingModel, roomCenters;

export async function createModel (){

    floorPlan = await loadJson('floorPlan');

    drawModel = createDrawModel();
    scene.add(drawModel);
    hide(drawModel.children);

    [floorModel, roomCenters] = createFloorModel();
    scene.add(floorModel);
    scene.add(roomCenters);

    skirtingModel = createWallsModel(true);
    scene.add(skirtingModel);

    wallsModel = createWallsModel();
    scene.add(wallsModel);

    await saveJson('floorPlan', floorPlan);
}


export function createDrawModel () {

  let points = getPointModels(floorPlan.points);
  let walls = getLineModels(floorPlan);

  let group = new THREE.Group();

  _.each(points, point => group.add(point));
  _.each(walls, wall => group.add(wall));

  _.each(floorPlan.walls, wall => {

      let distanceX = wall.to.x - wall.from.x;
      let distanceZ = wall.to.z - wall.from.z;

      let x = (wall.from.x + wall.to.x)/2;
      let z = (wall.from.z + wall.to.z)/2;

      // Move text from line position a little bit
      const move = 0.2;

      if(distanceX === 0){ x = x + move}
      if(distanceZ === 0){ z = z + move}
      if(distanceX !== 0 && distanceZ !== 0 ){
          x = x - Math.sign(distanceZ) * move;
          z = z + Math.sign(distanceX) * move;
      }

      let message = (Math.floor(Math.hypot(distanceX, distanceZ)*10)/10).toString() + 'm';

      let text = addText(message, x, 0, z);
      group.add(text);
  });

  return group;
}

export function createWallsModel (skirting=false) {

  let columns = getColumnsModels(floorPlan.points, skirting);
  let walls = getWallsModels(floorPlan, skirting);

  let group = new THREE.Group();

  _.each(walls, (wall) => group.add(wall));
  _.each(columns, (column) => group.add(column));

  return group;
}


function getPointModels (points) {
  return _.map(points, ({x, z, selected}) => {

      let geometry = new THREE.SphereBufferGeometry(0.06, 32, 32);
      let material = selected ? new THREE.MeshBasicMaterial({color: 0xe2a149}): new THREE.MeshBasicMaterial({color: 'white'});

      let mesh = new THREE.Mesh(geometry, material);

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.x = x;
      mesh.position.y = 0;
      mesh.position.z = z;

      return mesh;
  });
}

function getLineModels ({walls, points}) {
  return _.map(walls, ({from, to}) => {

      let geometry = new LineGeometry();
      let material = new LineMaterial({color: 0xffffff, linewidth: 0.0075, transparent: true, opacity: 0.9});

      geometry.setPositions([from.x, 0, from.z, to.x, 0, to.z]);

      return new Line2(geometry, material);
  });
}

function getColumnsModels (points, skirting=false){
  return _.map(points, ({x, z})=> {

      let height = skirting? HEIGHT/20 : HEIGHT;
      let depth = skirting? 1.2 * DEPTH : DEPTH;

      let geometry = new THREE.CylinderGeometry(depth/2, depth/2, height, 32);
      let material = skirting? skirtingMaterial : new THREE.MeshPhongMaterial({color: 0xffffff, transparent: true, opacity: 1});

      let mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(x, height/2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      return mesh;
  });
}

function getWallsModels ({walls, points}, skirting=false) {
  return _.map(walls, ({from, to}) => {

    let startPoint = _.find(points, {x:from.x, z:from.z});
    let endPoint = _.find(points, {x:to.x, z:to.z});
    let width = Math.hypot(from.x - to.x, from.z - to.z);

    let height = skirting? HEIGHT/20 : HEIGHT;
    let depth = skirting? 1.2 * DEPTH : DEPTH;

    let geometry = new THREE.BoxBufferGeometry(width, height, depth);
    let material = skirting? skirtingMaterial : new THREE.MeshStandardMaterial({
        roughness: 0.8,
        color: 0xffffff,
        bumpScale: 0.0005,
        metalness: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        transparent: true,
        opacity: 1,
    });

    let mesh = new THREE.Mesh(geometry, material);

    if(!skirting){
        let wall = _.find(floorPlan.walls, {from: {x:from.x, z:from.z}, to: {x:to.x, z:to.z}});

        if(wall.texture !== undefined){
            setTexture( wall.texture, material, [width,1]);
            wall.mesh = mesh.uuid;
        }
        if(wall.texture === undefined){
            setTexture( 'plaster', material, [width,1]);
            wall.mesh = mesh.uuid;
            wall.texture = 'plaster';
        }
    }

    let offsetX = startPoint.x - endPoint.x;
    let offsetZ = startPoint.z - endPoint.z;
    let angle = -Math.atan(offsetZ / offsetX);

    mesh.name = 'wall';

    mesh.position.set(endPoint.x + offsetX / 2, height / 2, endPoint.z + offsetZ / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotateY(angle);

    return mesh;
  });
}

export function createFloorModel() {

    let graph = new Graph();
    let points = floorPlan.points;
    let walls = floorPlan.walls;

    _.each(points, point => graph.addVertex(points.indexOf(point), {value: 1}));
    _.each(walls, wall => graph.addEdge(
        points.indexOf(_.find(points, {x:wall.from.x, z:wall.from.z})),
        points.indexOf(_.find(points, {x:wall.to.x, z:wall.to.z})),
        { value:1}));
    _.each(walls, wall => graph.addEdge(
        points.indexOf(_.find(points, {x:wall.to.x, z:wall.to.z})),
        points.indexOf(_.find(points, {x:wall.from.x, z:wall.from.z})),
        { value:1}));

    let cycles = [];
    let rooms = [];

    // remove 2 points loops
    for (let cycle of graph.cycles()){
        if(cycle.length>2){
          cycles.push(cycle)
        }
    }

    // remove loops containing other loops
    for (let i=0; i<cycles.length; i++) {

        let contained = false;
        for (let j = i + 1; j < cycles.length; j++) {
            if (cycles[j].every(val => cycles[i].includes(val))) {
                contained = true;
                break;
            }
        }
        if (!contained) {
            rooms.push(cycles[i]);
        }
    }

    let floor = new THREE.Group();
    let centers = [];
    let extrudeSettings = { depth: 0.03, bevelEnabled: false };

    // Filter rooms containing other rooms
    for( let room of rooms){

        let shape = new THREE.Shape();
        shape.moveTo(points[room[room.length-1]].x, points[room[room.length-1]].z);
        for( let point of room){
            shape.lineTo(points[point].x, points[point].z);
        }

        let geometry = new THREE.ExtrudeBufferGeometry(shape, extrudeSettings);
        geometry.computeBoundingBox();

        let center = geometry.boundingBox.getCenter( new THREE.Vector3());

        let overlapped = false;

        for( let room2 of rooms) {

            if(room !== room2 && room.length >= room2.length){

                let polygon = [];
                _.each(room2, point => { polygon.push([points[point].x, points[point].z])});

                if (inside([center.x, center.y], polygon)) {
                    overlapped = true;
                    break;
                }
            }
        }

        if(!overlapped){

            let material = new THREE.MeshStandardMaterial( {
                roughness: 0.8,
                color: 0xffffff,
                bumpScale: 0.0005,
                metalness: 0.2,
                polygonOffset: true,
                polygonOffsetFactor: -1
            });

            let mesh = new THREE.Mesh( geometry, material );

            let existingRoom = _.find(floorPlan.rooms, {center: center});

            if(existingRoom){
                setTexture( existingRoom.texture, material);
                existingRoom.mesh = mesh.uuid;
            }
            if(!existingRoom){
                setTexture( 'wood2', material);
                floorPlan.rooms.push({center:center, mesh:mesh.uuid, texture:'wood2'});
            }

            mesh.name = 'floor';

            mesh.rotateX(Math.PI/2);
            mesh.translateZ(-0.03);
            floor.add(mesh);
            centers.push(new THREE.Vector3(center.x, center.z, center.y));
        }
    }

    // Remove non existing rooms from floorPlan model
    for(let room of floorPlan.rooms){
        if(!_.find(centers, {x: room.center.x, y: room.center.z, z: room.center.y,})){
            _.remove(floorPlan.rooms, discard =>{ return discard === room })
        }
    }

    let centersGroup = new THREE.Group();
    _.each(getPointModels(centers), (wall) => centersGroup.add(wall));

    return [floor, centersGroup];
}


export async function updateScene(){

    scene.remove(drawModel);
    drawModel = createDrawModel();
    scene.add(drawModel);

    await saveJson('floorPlan', floorPlan);
}


export function updateModel(){

    scene.remove(floorModel);
    scene.remove(roomCenters);
    [floorModel,roomCenters] = createFloorModel();

    scene.add(floorModel);
    hide(floorModel.children);

    scene.add(roomCenters);
    hide(roomCenters.children);

    scene.remove(wallsModel);
    wallsModel = createWallsModel();
    scene.add(wallsModel);
    hide(wallsModel.children);

    scene.remove(skirtingModel);
    skirtingModel = createWallsModel(true);
    scene.add(skirtingModel);
    hide(skirtingModel.children);
}



