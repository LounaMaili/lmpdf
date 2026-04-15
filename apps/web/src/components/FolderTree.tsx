import { useCallback, useEffect, useState } from 'react';
import { createFolder, deleteFolder, listFolders, renameFolder } from '../api';
import type { FolderModel } from '../api';
import { useTranslation } from '../i18n';

type Props = {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onFoldersLoaded?: (folders: FolderModel[]) => void;
};

type TreeNode = FolderModel & { children: TreeNode[] };

function buildTree(folders: FolderModel[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const f of folders) map.set(f.id, { ...f, children: [] });

  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

function FolderNode({
  node,
  depth,
  selectedId,
  onSelect,
  onRename,
  onDelete,
  deleteTitle,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  deleteTitle: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);

  const commitRename = () => {
    if (editName.trim() && editName.trim() !== node.name) {
      onRename(node.id, editName.trim());
    }
    setEditing(false);
  };

  return (
    <div>
      <div
        className={`folder-node ${selectedId === node.id ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(node.id)}
      >
        {node.children.length > 0 ? (
          <span
            className="folder-toggle"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="folder-toggle" />
        )}
        <span className="folder-icon">📁</span>
        {editing ? (
          <input
            className="folder-rename-input"
            value={editName}
            autoFocus
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="folder-label"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(node.name); }}
          >
            {node.name}
          </span>
        )}
        <span
          className="folder-delete"
          title={deleteTitle}
          onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
        >
          ✕
        </span>
      </div>
      {expanded && node.children.map((child) => (
        <FolderNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          deleteTitle={deleteTitle}
        />
      ))}
    </div>
  );
}

export default function FolderTree({ selectedFolderId, onSelectFolder, onFoldersLoaded }: Props) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderModel[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const f = await listFolders();
    setFolders(f);
    onFoldersLoaded?.(f);
  }, [onFoldersLoaded]);

  useEffect(() => { refresh(); }, [refresh]);

  const tree = buildTree(folders);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createFolder(newName.trim(), selectedFolderId ?? undefined);
      setNewName('');
      await refresh();
    } catch { /* ignore */ }
    setCreating(false);
  };

  const handleRename = async (id: string, name: string) => {
    try {
      await renameFolder(id, name);
      await refresh();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('folders.deleteConfirm'))) return;
    try {
      await deleteFolder(id);
      if (selectedFolderId === id) onSelectFolder(null);
      await refresh();
    } catch { /* ignore */ }
  };

  return (
    <div className="folder-tree">
      <div className="folder-tree-header">
        <span className="folder-tree-title">{t('folders.title')}</span>
      </div>

      <div
        className={`folder-node ${selectedFolderId === null ? 'active' : ''}`}
        style={{ paddingLeft: 8 }}
        onClick={() => onSelectFolder(null)}
      >
        <span className="folder-icon">🏠</span>
        <span className="folder-label">{t('folders.allFiles')}</span>
      </div>

      {tree.map((node) => (
        <FolderNode
          key={node.id}
          node={node}
          depth={1}
          selectedId={selectedFolderId}
          onSelect={onSelectFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          deleteTitle={t('folders.deleteTitle')}
        />
      ))}

      <div className="folder-create">
        <input
          type="text"
          placeholder={t('folders.newPlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button disabled={creating || !newName.trim()} onClick={handleCreate}>+</button>
      </div>
    </div>
  );
}

/** Helper to build breadcrumb path from folder list */
export function buildBreadcrumb(folders: FolderModel[], folderId: string | null): FolderModel[] {
  if (!folderId) return [];
  const map = new Map(folders.map((f) => [f.id, f]));
  const path: FolderModel[] = [];
  let current = folderId;
  while (current) {
    const folder = map.get(current);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId!;
  }
  return path;
}
