export type Vec2 = [number, number]

export type OpeningType = 'door' | 'window'

export interface Storey {
  id: string
  name: string
  elevation: number
  height: number
}

export interface Wall {
  id: string
  storeyId: string
  start: Vec2
  end: Vec2
  thickness: number
  height: number
  material: string
}

export interface Opening {
  id: string
  wallId: string
  type: OpeningType
  /** Distance from wall start point to the near edge of the opening */
  offset: number
  width: number
  height: number
  sillHeight: number
}

export interface Room {
  id: string
  storeyId: string
  name: string
  polygon: Vec2[]
  floorMaterial: string
}

export interface FurnitureItem {
  id: string
  storeyId: string
  catalogId: string
  position: Vec2
  rotation: number
  scale: number
}

export interface Material {
  id: string
  name: string
  color: string
  textureUrl: string | null
}

export interface SceneGraph {
  schemaVersion: 1
  projectId: string
  units: 'm' | 'ft' | 'cm'
  storeys: Storey[]
  walls: Wall[]
  openings: Opening[]
  rooms: Room[]
  furniture: FurnitureItem[]
  materials: Material[]
}

/** A partial update to the scene graph — only the changed collections are included */
export type SceneDiff = Partial<Omit<SceneGraph, 'schemaVersion' | 'projectId' | 'units'>>

export function emptySceneGraph(projectId: string): SceneGraph {
  return {
    schemaVersion: 1,
    projectId,
    units: 'm',
    storeys: [],
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    materials: [
      { id: 'mat-plaster-white', name: 'White Plaster', color: '#f5f5f0', textureUrl: null },
      { id: 'mat-oak', name: 'Oak', color: '#b08850', textureUrl: null },
      { id: 'mat-concrete', name: 'Concrete', color: '#9e9e9e', textureUrl: null },
      { id: 'mat-brick', name: 'Brick', color: '#c1440e', textureUrl: null },
    ],
  }
}
