import {
  createSystem,
  PanelUI,
  PanelDocument,
  UIKit,
  UIKitDocument,
  Vector3,
} from "@iwsdk/core";

export class PortalSystem extends createSystem({
  messages: { required: [PanelUI, PanelDocument] },
}) {
  private tempVec!: Vector3;
  private pendingMessages: Map<number, string> = new Map();

  init() {
    this.tempVec = new Vector3();
    
    // Listen for messages from the separate portal.html page
    const channel = new BroadcastChannel('xr-portal');
    
    channel.onmessage = (event) => {
      if (event.data.type === 'SPAWN_MESSAGE') {
         this.spawnMessage(event.data.text || "Portal Message");
      }
    };

    // Handle document readiness for spawned messages
    this.queries.messages.subscribe("qualify", (entity) => {
       const config = entity.getValue(PanelUI, "config");
       if (config === "/ui/message.json") {
         const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
         if (doc) {
            const content = doc.getElementById("content") as UIKit.Text;
            const pendingText = this.pendingMessages.get(entity.index) || "Hello";
            content.setProperties({ text: pendingText });
            this.pendingMessages.delete(entity.index);
         }
       }
    });
  }

  spawnMessage(text: string) {
    const headPos = new Vector3();
    this.player.head.getWorldPosition(headPos);
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.player.head.quaternion);
    
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
