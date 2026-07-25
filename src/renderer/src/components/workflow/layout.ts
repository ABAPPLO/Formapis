import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

const NODE_WIDTH = 220
const NODE_HEIGHT = 100

/**
 * Auto-layout a DAG of nodes + edges using dagre (left-to-right flow).
 * Returns positioned nodes ready for ReactFlow.
 */
export function layoutDag(nodes: Node[], edges: Edge[], direction: 'LR' | 'TB' = 'LR'): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 80,
    marginx: 20,
    marginy: 20
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const positioned = g.node(node.id)
    return {
      ...node,
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - NODE_HEIGHT / 2
      },
      style: { width: NODE_WIDTH }
    }
  })
}
