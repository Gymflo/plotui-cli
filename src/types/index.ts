export type Framework = 'nextjs-app' | 'nextjs-pages' | 'react-vite' | 'cra';

export interface Node {
  key: string;
  label: string;
  description: string;
  roles: string[];
  conditions: string[];
  confidence: 'green' | 'yellow' | 'red';
  ai_question: string | null;
  ui_elements: UIElement[];
  position_x?: number;
  position_y?: number;
}

export interface UIElement {
  type: 'button' | 'link' | 'input' | 'text' | 'tab' | 'dialog' | 'select-option' | 'toast';
  label: string;
  action: string;
}

export interface Edge {
  from: string;
  to: string;
  label: string | null;
  condition: string | null;
}

export interface KnowledgeGraph {
  framework: Framework;
  app_name: string;
  nodes: Node[];
  edges: Edge[];
}

export interface ParsedFile {
  path: string;
  route: string;
  component: string;
  elements: UIElement[];
  imports: string[];
  conditions: string[];
  roles: string[];
}
