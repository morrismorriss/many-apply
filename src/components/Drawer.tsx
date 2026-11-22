import { useStore, type DrawerTarget } from "../store";
import { GrantDrawer } from "./GrantDrawer";
import { FunderDrawer } from "./FunderDrawer";
import { ClientDrawer } from "./ClientDrawer";
import { LibraryDrawer } from "./LibraryDrawer";
import { DonorDrawer } from "./DonorDrawer";
import { SampleDrawer } from "./SampleDrawer";
import { DocumentDrawer } from "./DocumentDrawer";
import { FeedsPanel } from "./FeedsPanel";

const LABEL: Record<DrawerTarget["kind"], string> = {
  grant: "Application",
  funder: "Funder",
  client: "Client",
  donor: "Donor",
  library: "Library",
  sample: "Work sample",
  document: "Document",
  feeds: "Opportunity feeds",
};

export function Drawer({ target }: { target: DrawerTarget }) {
  const pinned = useStore((s) => s.drawerPinned);
  const expanded = useStore((s) => s.drawerExpanded);
  const setDrawer = useStore((s) => s.setDrawer);
  const close = useStore((s) => s.closeDrawer);
  return (
    <aside className={`drawer${pinned ? " pinned" : ""}${expanded ? " expanded" : ""}`} aria-label={LABEL[target.kind]}>
      <div className="drawer-bar">
        <span className="crumb">
          {LABEL[target.kind]}
          {target.kind !== "feeds" && ` · ${target.id}`}
        </span>
        <button className={`icon-btn${pinned ? " on" : ""}`} title={pinned ? "Unpin" : "Pin open"} onClick={() => setDrawer({ pinned: !pinned })}>
          ⚲
        </button>
        <button className="icon-btn" title={expanded ? "Back to side panel" : "Expand to full screen"} onClick={() => setDrawer({ expanded: !expanded })}>
          {expanded ? "⤡" : "⤢"}
        </button>
        <button className="icon-btn" title="Close (Esc)" onClick={close}>
          ×
        </button>
      </div>
      <div className="drawer-body">
        {target.kind === "grant" && <GrantDrawer key={target.id} folder={target.id} />}
        {target.kind === "funder" && <FunderDrawer key={target.id} slug={target.id} />}
        {target.kind === "client" && <ClientDrawer key={target.id} slug={target.id} />}
        {target.kind === "donor" && <DonorDrawer key={target.id} slug={target.id} />}
        {target.kind === "library" && <LibraryDrawer key={target.id} path={target.id} />}
        {target.kind === "sample" && <SampleDrawer key={target.id} path={target.id} />}
        {target.kind === "document" && <DocumentDrawer key={target.id} path={target.id} />}
        {target.kind === "feeds" && <FeedsPanel />}
      </div>
    </aside>
  );
}
