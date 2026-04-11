import {
  createComponent,
  createSystem,
  Types,
  Transform,
  Vector3,
  Quaternion,
} from "@iwsdk/core";

export const Synced = createComponent("Synced", {
  id: { type: Types.String, default: "" },
});

export class SyncSystem extends createSystem({
  synced: { required: [Synced, Transform] },
  proxies: { required: [Synced] },
}) {
  private channel = new BroadcastChannel("xr-sync");
  private isProducer = false;
  private tempPos = new Vector3();
  private tempQuat = new Quaternion();

  init() {
    this.isProducer = !window.location.pathname.includes("broadcast");

    if (!this.isProducer) {
      this.channel.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    }
  }

  update() {
    if (this.isProducer) {
      const updates: any[] = [];
      for (const entity of this.queries.synced.entities) {
        const id = entity.getValue(Synced, "id");
        const pos = entity.getVectorView(Transform, "position") as Float32Array;
        const rot = entity.getVectorView(Transform, "orientation") as Float32Array;
        
        updates.push({
          id,
          pos: [pos[0], pos[1], pos[2]],
          rot: [rot[0], rot[1], rot[2], rot[3]],
        });
      }
      
      const head = this.player.head;
      head.getWorldPosition(this.tempPos);
      head.getWorldQuaternion(this.tempQuat);

      updates.push({
        id: "player_head",
        pos: [this.tempPos.x, this.tempPos.y, this.tempPos.z],
        rot: [this.tempQuat.x, this.tempQuat.y, this.tempQuat.z, this.tempQuat.w],
      });

      if (updates.length > 0) {
        this.channel.postMessage({ type: "SYNC_UPDATES", updates });
      }
    }
  }

  private handleMessage(data: any) {
    if (data.type === "SYNC_UPDATES") {
      for (const update of data.updates) {
        let proxy = Array.from(this.queries.proxies.entities).find(e => 
          e.getValue(Synced, "id") === update.id
        );

        if (!proxy) {
           proxy = this.world.createTransformEntity();
           proxy.addComponent(Synced, { id: update.id });
        }

        const posView = proxy.getVectorView(Transform, "position") as Float32Array;
        const rotView = proxy.getVectorView(Transform, "orientation") as Float32Array;
        
        posView[0] = update.pos[0];
        posView[1] = update.pos[1];
        posView[2] = update.pos[2];

        rotView[0] = update.rot[0];
        rotView[1] = update.rot[1];
        rotView[2] = update.rot[2];
        rotView[3] = update.rot[3];
      }
    }
  }
}
