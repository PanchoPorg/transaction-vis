declare module "elkjs/lib/elk.bundled.js" {
  export type ElkLayoutNode = {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    layoutOptions?: Record<string, string>;
    children?: ElkLayoutNode[];
    edges?: Array<{ id: string; sources: string[]; targets: string[] }>;
  };

  export default class ELK {
    layout(graph: ElkLayoutNode): Promise<ElkLayoutNode>;
  }
}
