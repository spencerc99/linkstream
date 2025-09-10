export interface LinkPost {
  url: string;
  timestamp: number;
  postAuthor: string;
  postId: string;
  postText: string;
  title?: string;
  description?: string;
  //
  thumbnail?: string;
}

export interface ExternalEmbed {
  uri: string;
  title?: string;
  description?: string;
  thumb?: string;
}

export type VisualMode = "grid" | "focus" | "meteor";
export type ContentFilter = "all" | "tv" | "radio" | "flipbook";

export interface RemoteControlState {
  visualMode: VisualMode;
  contentFilter: ContentFilter;
  isPaused: boolean;
  speed: number;
}
