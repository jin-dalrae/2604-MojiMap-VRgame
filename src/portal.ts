import {
  createSystem,
  PanelUI,
  PanelDocument,
  UIKit,
  UIKitDocument,
  Vector3,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  TextureLoader,
  DoubleSide,
  SRGBColorSpace,
  Interactable,
  DistanceGrabbable,
  MovementMode,
} from "@iwsdk/core";

// Map portal item types to their texture files
const ITEM_TEXTURES: Record<string, string> = {
  ghost: "/textures/Ghost.png",
  bird: "/textures/Bird.png",
  snowman: "/textures/Snowman.png",
  hammer: "/textures/Hammer.png",
  gun: "/textures/Gun.png",
  chair: "/textures/Chair.png",
  cube: "",
  sphere: "",
  cylinder: "",
};

// Size of each billboard in meters
const BILLBOARD_SIZE = 0.5;

export class PortalSystem extends createSystem({
  messages: { required: [PanelUI, PanelDocument] },
}) {
  private tempVec!: Vector3;
  private pendingMessages: Map<number, string> = new Map();
  private textureLoader!: TextureLoader;
  private spawnedEntities: any[] = [];

  init() {
    this.tempVec = new Vector3();
    this.textureLoader = new TextureLoader();

    // Listen for messages from the separate portal.html page
    const channel = new BroadcastChannel("xr-portal");

    channel.onmessage = (event) => {
      if (event.data.type === "SPAWN_MESSAGE") {
        this.spawnMessage(event.data.text || "Portal Message");
      }
      if (event.data.type === "SPAWN_GRID") {
        this.spawnGrid(event.data.items);
      }
    };

    // Handle document readiness for spawned messages
    this.queries.messages.subscribe("qualify", (entity) => {
      const config = entity.getValue(PanelUI, "config");
      if (config === "/ui/message.json") {
        const doc =
          PanelDocument.data.document[entity.index] as UIKitDocument;
        if (doc) {
          const content = doc.getElementById("content") as UIKit.Text;
          const pendingText =
            this.pendingMessages.get(entity.index) || "Hello";
          content.setProperties({ text: pendingText });
          this.pendingMessages.delete(entity.index);
        }
      }
    });
  }

  spawnGrid(items: Array<{ row: number; col: number; type: string; icon: string; label: string }>) {
    // Clear previously spawned grid items
    for (const entity of this.spawnedEntities) {
      entity.dispose();
    }
    this.spawnedEntities = [];

    // Grid mapping: 10x10 grid, each cell = 1 meter, centered at origin
    const GRID_SIZE = 10;
    const HALF = GRID_SIZE / 2;

    for (const item of items) {
      const texturePath = ITEM_TEXTURES[item.type];

      // Convert grid row/col to world XZ position
      // col -> X axis, row -> Z axis, centered at origin
      const worldX = item.col - HALF + 0.5;
      const worldZ = item.row - HALF + 0.5;
      const worldY = 0.5; // Slightly above ground

      if (texturePath) {
        // Spawn textured billboard for items with custom art
        this.spawnBillboard(texturePath, worldX, worldY, worldZ);
      }
    }

    console.log(`[PortalSystem] Spawned ${items.length} grid items`);
  }

  private spawnBillboard(texturePath: string, x: number, y: number, z: number) {
    const texture = this.textureLoader.load(texturePath);
    texture.colorSpace = SRGBColorSpace;

    const geometry = new PlaneGeometry(BILLBOARD_SIZE, BILLBOARD_SIZE);
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });

    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);

    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(Interactable);
    entity.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveFromTarget,
    });

    this.spawnedEntities.push(entity);
  }

  spawnMessage(text: string) {
    const headPos = new Vector3();
    this.player.head.getWorldPosition(headPos);
    const forward = new Vector3(0, 0, -1).applyQuaternion(
      this.player.head.quaternion,
    );

    const spawnPos = headPos.add(forward.multiplyScalar(1.5)); // 1.5m in front of player

    const entity = this.world.createTransformEntity();
    this.pendingMessages.set(entity.index, text);

    entity.addComponent(PanelUI, {
      config: "/ui/message.json",
      maxWidth: 1.0,
      maxHeight: 0.5,
    });
    entity.object3D!.position.copy(spawnPos);
    entity.object3D!.lookAt(headPos);
  }
}
