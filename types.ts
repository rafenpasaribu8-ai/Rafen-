
export enum AIMode {
  FAST = 'FAST',
  THINKING = 'THINKING',
  SEARCH = 'SEARCH',
  IMAGE = 'IMAGE',
  CODING = 'CODING'
}

export enum AIPersona {
  NETRAL = 'NETRAL',
  BUCIN = 'BUCIN'
}

export interface MessagePart {
  text?: string;
  image?: string;
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  parts: MessagePart[];
  mode?: AIMode;
  persona?: AIPersona;
  thinking?: string;
  isThinking?: boolean;
  groundingLinks?: GroundingChunk[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey?: () => Promise<boolean>;
      openSelectKey?: () => Promise<void>;
    };
  }
}
