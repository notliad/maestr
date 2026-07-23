export type FileKind = "file" | "directory";

export type FileEntry = {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  project?: boolean;
};

export type OpenFile = {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
};
