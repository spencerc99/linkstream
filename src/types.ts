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
