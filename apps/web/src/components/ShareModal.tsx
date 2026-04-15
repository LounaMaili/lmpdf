import { useCallback, useEffect, useState } from 'react';
import {
  listDocPermissions, shareDocument, revokeDocPermission,
  searchUsers, listGroups, createGroup, getGroupDetails,
  addGroupMember, removeGroupMember, deleteGroup,
} from '../api';
import type { DocPermission } from '../api';
import { useTranslation } from '../i18n';

type Props = {
  docId: string;
  onClose: () => void;
};

type GroupInfo = { id: string; name: string; _count?: { members: number } };
type GroupDetail = { id: string; name: string; members: Array<{ user: { id: string; email: string; displayName: string } }> };

export default function ShareModal({ docId, onClose }: Props) {
  const { t } = useTranslation();

  const ROLE_LABELS: Record<string, string> = {
    owner: t('roles.owner'),
    editor: t('roles.editor'),
    filler: t('roles.filler'),
  };

  const [permissions, setPermissions] = useState<DocPermission[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; email: string; displayName: string }>>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [selectedRole, setSelectedRole] = useState<'editor' | 'filler'>('filler');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  // Group management
  const [activeTab, setActiveTab] = useState<'share' | 'groups'>('share');
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [groupMemberSearch, setGroupMemberSearch] = useState('');
  const [groupMemberResults, setGroupMemberResults] = useState<Array<{ id: string; email: string; displayName: string }>>([]);

  const refresh = useCallback(async () => {
    try {
      const perms = await listDocPermissions(docId);
      setPermissions(perms);
    } catch {
      setStatus(t('share.loadingPermissionsError'));
    }
  }, [docId, t]);

  const refreshGroups = useCallback(async () => {
    const g = await listGroups();
    setGroups(g);
  }, []);

  useEffect(() => {
    refresh();
    refreshGroups();
  }, [refresh, refreshGroups]);

  // Debounced user search (share tab)
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchResults(await searchUsers(searchQuery));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Debounced user search (group member tab)
  useEffect(() => {
    if (groupMemberSearch.length < 2) { setGroupMemberResults([]); return; }
    const timer = setTimeout(async () => {
      setGroupMemberResults(await searchUsers(groupMemberSearch));
    }, 300);
    return () => clearTimeout(timer);
  }, [groupMemberSearch]);

  const handleShareUser = async (userId: string) => {
    setLoading(true);
    try {
      await shareDocument(docId, { userId, docRole: selectedRole });
      setSearchQuery(''); setSearchResults([]);
      setStatus(t('share.userAdded'));
      await refresh();
    } catch (e) { setStatus(e instanceof Error ? e.message : t('common.error')); }
    setLoading(false);
  };

  const handleShareGroup = async (groupId: string) => {
    setLoading(true);
    try {
      await shareDocument(docId, { groupId, docRole: selectedRole });
      setStatus(t('share.groupAdded'));
      await refresh();
    } catch (e) { setStatus(e instanceof Error ? e.message : t('common.error')); }
    setLoading(false);
  };

  const handleRevoke = async (perm: DocPermission) => {
    if (!confirm(t('share.revokeConfirm', { name: perm.user?.displayName || perm.group?.name || '' }))) return;
    setLoading(true);
    try {
      await revokeDocPermission(docId, { userId: perm.userId, groupId: perm.groupId });
      setStatus(t('share.accessRevoked'));
      await refresh();
    } catch (e) { setStatus(e instanceof Error ? e.message : t('common.error')); }
    setLoading(false);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setLoading(true);
    try {
      await createGroup(newGroupName.trim(), true);
      setNewGroupName('');
      setStatus(t('share.groupCreated'));
      await refreshGroups();
    } catch (e) { setStatus(e instanceof Error ? e.message : t('common.error')); }
    setLoading(false);
  };

  const handleSelectGroup = async (g: GroupInfo) => {
    try {
      const detail = await getGroupDetails(g.id);
      setSelectedGroup(detail);
    } catch { setStatus(t('share.loadingGroupError')); }
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedGroup) return;
    setLoading(true);
    try {
      await addGroupMember(selectedGroup.id, userId);
      setGroupMemberSearch(''); setGroupMemberResults([]);
      const detail = await getGroupDetails(selectedGroup.id);
      setSelectedGroup(detail);
      setStatus(t('share.memberAdded'));
      await refreshGroups();
    } catch (e) { setStatus(e instanceof Error ? e.message : t('common.error')); }
    setLoading(false);
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedGroup) return;
    setLoading(true);
    try {
      await removeGroupMember(selectedGroup.id, userId);
      const detail = await getGroupDetails(selectedGroup.id);
      setSelectedGroup(detail);
      setStatus(t('share.memberRemoved'));
      await refreshGroups();
    } catch (e) { setStatus(e instanceof Error ? e.message : t('common.error')); }
    setLoading(false);
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm(t('share.deleteGroupConfirm'))) return;
    setLoading(true);
    try {
      await deleteGroup(groupId);
      if (selectedGroup?.id === groupId) setSelectedGroup(null);
      setStatus(t('share.groupDeleted'));
      await refreshGroups();
    } catch (e) { setStatus(e instanceof Error ? e.message : t('common.error')); }
    setLoading(false);
  };

  return (
    <div className="share-modal-backdrop" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <h3>{t('share.title')}</h3>
          <button className="share-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="share-tabs">
          <button className={activeTab === 'share' ? 'active' : ''} onClick={() => setActiveTab('share')}>
            {t('share.tabShare')}
          </button>
          <button className={activeTab === 'groups' ? 'active' : ''} onClick={() => setActiveTab('groups')}>
            {t('share.tabGroups')}
          </button>
        </div>

        {activeTab === 'share' && (
          <>
            {/* Role selector */}
            <div className="share-role-select">
              <label>{t('share.roleToAssign')}</label>
              <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value as any)}>
                <option value="editor">{t('share.roleEditor')}</option>
                <option value="filler">{t('share.roleFiller')}</option>
              </select>
            </div>

            {/* User search */}
            <div className="share-search">
              <input
                type="text"
                placeholder={t('share.searchUserPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchResults.length > 0 && (
                <ul className="share-search-results">
                  {searchResults.map((u) => (
                    <li key={u.id}>
                      <span>{u.displayName} ({u.email})</span>
                      <button disabled={loading} onClick={() => handleShareUser(u.id)}>+ {t('common.add')}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Group share */}
            {groups.length > 0 && (
              <div className="share-groups">
                <label>{t('share.shareWithGroup')}</label>
                <div className="share-groups-list">
                  {groups.map((g) => (
                    <button key={g.id} disabled={loading} onClick={() => handleShareGroup(g.id)}>
                      👥 {g.name} {g._count ? `(${g._count.members})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Current permissions */}
            <div className="share-current">
              <h4>{t('share.currentAccess')}</h4>
              {permissions.length === 0 ? (
                <p className="share-empty">{t('share.noShares')}</p>
              ) : (
                <ul className="share-perm-list">
                  {permissions.map((p) => (
                    <li key={p.id}>
                      <span className="share-perm-name">
                        {p.user ? `👤 ${p.user.displayName} (${p.user.email})` : `👥 ${p.group?.name}`}
                      </span>
                      <span className="share-perm-role">{ROLE_LABELS[p.docRole] || p.docRole}</span>
                      <button className="share-revoke" disabled={loading} onClick={() => handleRevoke(p)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {activeTab === 'groups' && (
          <div className="groups-management">
            {/* Create group */}
            <div className="group-create">
              <input
                type="text"
                placeholder={t('share.newGroupPlaceholder')}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
              />
              <button disabled={loading || !newGroupName.trim()} onClick={handleCreateGroup}>+ {t('common.create')}</button>
            </div>

            {/* Group list */}
            <div className="group-list">
              {groups.length === 0 ? (
                <p className="share-empty">{t('share.noGroups')}</p>
              ) : (
                <ul>
                  {groups.map((g) => (
                    <li key={g.id} className={selectedGroup?.id === g.id ? 'active' : ''}>
                      <span className="group-name" onClick={() => handleSelectGroup(g)}>
                        👥 {g.name} {g._count ? `(${g._count.members} ${t('share.members')})` : ''}
                      </span>
                      <button className="share-revoke" onClick={() => handleDeleteGroup(g.id)} title={t('common.delete')}>🗑</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Group detail: members */}
            {selectedGroup && (
              <div className="group-detail">
                <h4>{t('share.groupMembers', { name: selectedGroup.name })}</h4>

                <div className="share-search">
                  <input
                    type="text"
                    placeholder={t('share.addMemberPlaceholder')}
                    value={groupMemberSearch}
                    onChange={(e) => setGroupMemberSearch(e.target.value)}
                  />
                  {groupMemberResults.length > 0 && (
                    <ul className="share-search-results">
                      {groupMemberResults.map((u) => (
                        <li key={u.id}>
                          <span>{u.displayName} ({u.email})</span>
                          <button disabled={loading} onClick={() => handleAddMember(u.id)}>+ {t('common.add')}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selectedGroup.members.length === 0 ? (
                  <p className="share-empty">{t('share.noMembers')}</p>
                ) : (
                  <ul className="share-perm-list">
                    {selectedGroup.members.map((m) => (
                      <li key={m.user.id}>
                        <span className="share-perm-name">👤 {m.user.displayName} ({m.user.email})</span>
                        <button className="share-revoke" disabled={loading} onClick={() => handleRemoveMember(m.user.id)}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {status && <div className="share-status">{status}</div>}
      </div>
    </div>
  );
}
