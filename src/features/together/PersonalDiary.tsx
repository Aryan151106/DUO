import React, { useState, useMemo } from 'react';
import {
  Lock,
  Plus,
  Search,
  BookOpen,
  Calendar,
  Sparkles,
  Edit3,
  Trash2,
  X,
  Shield,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { DiaryEntry } from '../../lib/dataStore';
import { duoDataStore } from '../../lib/dataStore';
import { useAuthStore } from '../../lib/store';
import {
  useDiaryEntries,
  addDiaryEntry,
  updateDiaryEntry,
  deleteDiaryEntry,
} from '../../lib/firestore';
import { soundEffects } from '../../lib/sound';
import confetti from 'canvas-confetti';

const MOOD_OPTIONS = [
  { label: '🌸 Peaceful', icon: '🌸' },
  { label: '💖 Grateful', icon: '💖' },
  { label: '☕ Cozy', icon: '☕' },
  { label: '✨ Inspired', icon: '✨' },
  { label: '💭 Reflective', icon: '💭' },
  { label: '🌧️ Vulnerable', icon: '🌧️' },
  { label: '🧘 Calm', icon: '🧘' },
  { label: '🔥 Energetic', icon: '🔥' },
];

const WRITING_PROMPTS = [
  'What made you smile or feel loved today?',
  'What is a quiet thought on your mind that you want to untangle?',
  'What is a memory with your partner that always warms your heart?',
  'What are you looking forward to this week?',
  'How are your mind, heart, and body feeling right now?',
];

const formatDiaryDate = (dateVal?: string, fmt = 'MMM d, yyyy'): string => {
  if (!dateVal) return 'Today';
  try {
    const d = parseISO(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    return format(d, fmt);
  } catch {
    return dateVal;
  }
};

export const PersonalDiary: React.FC = () => {
  const { currentUser, partnerUser, couple, isDemoMode } = useAuthStore();

  // Firestore hook
  const { entries: firestoreEntries } = useDiaryEntries(
    !isDemoMode ? couple?.id || null : null,
    currentUser.id
  );

  // Demo local entries
  const [localDemoEntries, setLocalDemoEntries] = useState<DiaryEntry[]>(() =>
    isDemoMode ? duoDataStore.getDiaryEntries(currentUser.id) : []
  );

  // Re-sync local demo entries when user switches profile (Alex <-> Sam)
  React.useEffect(() => {
    if (isDemoMode) {
      setLocalDemoEntries(duoDataStore.getDiaryEntries(currentUser.id));
    }
  }, [currentUser.id, isDemoMode]);

  const entries: DiaryEntry[] = isDemoMode ? localDemoEntries : firestoreEntries;

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMoodFilter, setSelectedMoodFilter] = useState<string>('all');

  // Modal / Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const [readingEntry, setReadingEntry] = useState<DiaryEntry | null>(null);

  // Form inputs
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [entryDate, setEntryDate] = useState(todayStr);
  const [entryTitle, setEntryTitle] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [entryMood, setEntryMood] = useState('🌸 Peaceful');
  const [entryTagInput, setEntryTagInput] = useState('');

  const filteredEntries = useMemo(() => {
    return entries.filter((item) => {
      // Must match search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesContent = item.content.toLowerCase().includes(q);
        if (!matchesTitle && !matchesContent) return false;
      }
      // Must match mood filter
      if (selectedMoodFilter !== 'all' && item.mood !== selectedMoodFilter) {
        return false;
      }
      return true;
    });
  }, [entries, searchQuery, selectedMoodFilter]);

  const openNewEntryForm = (promptText?: string) => {
    soundEffects.playPop();
    setEditingEntry(null);
    setEntryDate(todayStr);
    setEntryTitle(promptText ? promptText : '');
    setEntryContent('');
    setEntryMood('🌸 Peaceful');
    setEntryTagInput('');
    setIsFormOpen(true);
  };

  const openEditForm = (item: DiaryEntry) => {
    soundEffects.playPop();
    setEditingEntry(item);
    setEntryDate(item.date || todayStr);
    setEntryTitle(item.title);
    setEntryContent(item.content);
    setEntryMood(item.mood || '🌸 Peaceful');
    setEntryTagInput(item.tags?.join(', ') || '');
    setIsFormOpen(true);
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryTitle.trim() || !entryContent.trim()) return;

    soundEffects.playSuccess();
    confetti({ particleCount: 35, spread: 50, origin: { y: 0.6 } });

    const tags = entryTagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (isDemoMode) {
      if (editingEntry) {
        const updated = localDemoEntries.map((item) =>
          item.id === editingEntry.id
            ? {
                ...item,
                title: entryTitle.trim(),
                content: entryContent.trim(),
                mood: entryMood,
                date: entryDate,
                tags,
                updatedAt: new Date().toISOString(),
              }
            : item
        );
        setLocalDemoEntries(updated);
        duoDataStore.saveDiaryEntries(currentUser.id, updated);
      } else {
        const newEntry: DiaryEntry = {
          id: `diary-${Date.now()}`,
          userId: currentUser.id,
          title: entryTitle.trim(),
          content: entryContent.trim(),
          mood: entryMood,
          date: entryDate,
          tags,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const updated = [newEntry, ...localDemoEntries];
        setLocalDemoEntries(updated);
        duoDataStore.saveDiaryEntries(currentUser.id, updated);
      }
    } else if (couple?.id) {
      if (editingEntry) {
        await updateDiaryEntry(couple.id, editingEntry.id, {
          title: entryTitle.trim(),
          content: entryContent.trim(),
          mood: entryMood,
          date: entryDate,
          tags,
        });
      } else {
        await addDiaryEntry(couple.id, {
          userId: currentUser.id,
          title: entryTitle.trim(),
          content: entryContent.trim(),
          mood: entryMood,
          date: entryDate,
          tags,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    setIsFormOpen(false);
    setEditingEntry(null);
  };

  const handleDeleteEntry = async (entryId: string) => {
    soundEffects.playPop();
    if (isDemoMode) {
      const updated = localDemoEntries.filter((item) => item.id !== entryId);
      setLocalDemoEntries(updated);
      duoDataStore.saveDiaryEntries(currentUser.id, updated);
    } else if (couple?.id) {
      await deleteDiaryEntry(couple.id, entryId);
    }
    if (readingEntry?.id === entryId) {
      setReadingEntry(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* 1. Cozy Privacy Assurance Header */}
      <div className="p-5 sm:p-6 rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--partner-a)]/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-2xl bg-[var(--partner-a)]/20 border border-[var(--partner-a)] flex items-center justify-center text-[var(--partner-a)]">
                <BookOpen className="w-5 h-5 stroke-[2.5]" />
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[var(--text)]">
                Personal Diary
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 text-[11px] font-chunky font-bold">
                <Lock className="w-3 h-3 stroke-[3]" />
                <span>100% Private to You</span>
              </span>
            </div>
            <p className="font-body text-xs sm:text-sm text-[var(--text-muted)] max-w-xl">
              A gentle sanctuary for your unedited thoughts, feelings, and secret gratitudes. Entries here are never visible to{' '}
              <strong className="text-[var(--text)]">{partnerUser.displayName || 'your partner'}</strong>.
            </p>
          </div>

          <button
            type="button"
            onClick={() => openNewEntryForm()}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[var(--partner-a)] hover:opacity-90 text-white font-chunky font-bold text-sm border-2 border-[var(--border)] shadow-[0_3px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>New Diary Entry</span>
          </button>
        </div>

        {/* Daily Writing Prompts Row */}
        <div className="mt-4 pt-4 border-t-2 border-[var(--border)]">
          <div className="flex items-center gap-1.5 text-xs font-chunky font-bold text-[var(--text)] mb-2 uppercase tracking-wide">
            <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Gentle Writing Prompts</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {WRITING_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openNewEntryForm(prompt)}
                className="px-3 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)]/30 border border-[var(--border)] text-xs font-ui text-[var(--text)] whitespace-nowrap cursor-pointer transition-colors shadow-xs"
              >
                "{prompt}"
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Search & Mood Filters */}
      <div className="card p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your entries..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--partner-a)]"
          />
        </div>

        {/* Mood filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedMoodFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-ui font-bold whitespace-nowrap transition-colors cursor-pointer border ${
              selectedMoodFilter === 'all'
                ? 'bg-[var(--partner-a)] text-white border-[var(--border)] shadow-xs'
                : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
            }`}
          >
            All Moods
          </button>
          {MOOD_OPTIONS.map((m) => (
            <button
              key={m.label}
              type="button"
              onClick={() => setSelectedMoodFilter(m.label)}
              className={`px-3 py-1.5 rounded-xl text-xs font-ui font-semibold whitespace-nowrap transition-colors cursor-pointer border ${
                selectedMoodFilter === m.label
                  ? 'bg-[var(--partner-a)] text-white border-[var(--border)] shadow-xs'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Diary Entries Grid */}
      {filteredEntries.length === 0 ? (
        <div className="card p-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-center mx-auto text-2xl">
            📖
          </div>
          <h3 className="font-chunky text-base font-bold text-[var(--text)]">
            {searchQuery ? 'No entries match your search' : 'Your private diary is waiting'}
          </h3>
          <p className="text-xs font-ui text-[var(--text-muted)] max-w-sm mx-auto">
            {searchQuery
              ? 'Try searching with different keywords or clearing your mood filter.'
              : 'Write your very first entry. It stays safely locked for your eyes only.'}
          </p>
          {!searchQuery && (
            <button
              type="button"
              onClick={() => openNewEntryForm()}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-xs border border-[var(--border)] shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Write First Entry</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              onClick={() => {
                soundEffects.playPop();
                setReadingEntry(entry);
              }}
              className="card p-5 border-2 border-[var(--border)] hover:border-[var(--partner-a)] shadow-[0_3px_0_var(--shadow-color)] hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between space-y-3"
            >
              <div>
                {/* Date & Mood header */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-numeric font-bold text-[var(--text-muted)]">
                    <Calendar className="w-3.5 h-3.5 text-[var(--partner-a)]" />
                    <span>{formatDiaryDate(entry.date || entry.createdAt, 'MMM d, yyyy')}</span>
                  </div>
                  {entry.mood && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-ui font-bold bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]">
                      {entry.mood}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h3 className="font-chunky text-base font-bold text-[var(--text)] leading-snug line-clamp-2">
                  {entry.title}
                </h3>

                {/* Content snippet */}
                <p className="font-body text-xs text-[var(--text-muted)] line-clamp-4 mt-2 leading-relaxed">
                  {entry.content}
                </p>
              </div>

              {/* Tags & Action Row */}
              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 overflow-hidden">
                  {entry.tags?.slice(0, 2).map((t, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-lg bg-[var(--surface-2)] text-[10px] font-ui text-[var(--text-muted)] truncate"
                    >
                      #{t}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditForm(entry);
                    }}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                    title="Edit entry"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEntry(entry.id);
                    }}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--urgent)] hover:bg-[var(--surface-2)] transition-colors"
                    title="Delete entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Reading Modal */}
      {readingEntry && (
        <div
          onClick={() => setReadingEntry(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card max-w-xl w-full p-6 sm:p-8 relative border-3 border-[var(--border)] shadow-[0_6px_0_var(--shadow-color)] max-h-[85vh] overflow-y-auto space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-numeric font-bold text-[var(--partner-a)] flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDiaryDate(readingEntry.date || readingEntry.createdAt, 'EEEE, MMMM d, yyyy')}</span>
                  </span>
                  {readingEntry.mood && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-ui font-bold bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]">
                      {readingEntry.mood}
                    </span>
                  )}
                </div>
                <h2 className="font-display text-2xl font-bold text-[var(--text)] leading-tight">
                  {readingEntry.title}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setReadingEntry(null)}
                className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="pt-3 border-t-2 border-[var(--border)]">
              <p className="font-body text-sm sm:text-base text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                {readingEntry.content}
              </p>
            </div>

            {readingEntry.tags && readingEntry.tags.length > 0 && (
              <div className="flex items-center gap-1.5 pt-3 border-t border-[var(--border)] flex-wrap">
                {readingEntry.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-xl bg-[var(--surface-2)] text-xs font-ui text-[var(--text-muted)]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] font-ui text-emerald-600 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                <span>Private entry</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const toEdit = readingEntry;
                    setReadingEntry(null);
                    openEditForm(toEdit);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 text-xs font-chunky font-bold text-[var(--text)] border border-[var(--border)] cursor-pointer"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setReadingEntry(null)}
                  className="px-4 py-1.5 rounded-xl bg-[var(--partner-a)] text-white text-xs font-chunky font-bold shadow-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Create / Edit Diary Entry Modal */}
      {isFormOpen && (
        <div
          onClick={() => setIsFormOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card max-w-xl w-full p-6 sm:p-7 relative border-3 border-[var(--border)] shadow-[0_6px_0_var(--shadow-color)] my-auto max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b-2 border-[var(--border)]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[var(--partner-a)]" />
                <h3 className="font-display text-xl font-bold text-[var(--text)]">
                  {editingEntry ? 'Edit Diary Entry' : 'New Private Entry'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEntry} className="mt-4 space-y-4">
              {/* Date & Mood Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                    Mood
                  </label>
                  <select
                    value={entryMood}
                    onChange={(e) => setEntryMood(e.target.value)}
                    className="w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text)] focus:outline-none"
                  >
                    {MOOD_OPTIONS.map((m) => (
                      <option key={m.label} value={m.label}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                  Entry Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="Give your thought or day a name..."
                  value={entryTitle}
                  onChange={(e) => setEntryTitle(e.target.value)}
                  className="w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm font-chunky font-bold text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--partner-a)]"
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                  Private Thoughts & Reflections
                </label>
                <textarea
                  required
                  rows={8}
                  placeholder="Pour your thoughts freely here. No one else has access to this space..."
                  value={entryContent}
                  onChange={(e) => setEntryContent(e.target.value)}
                  className="w-full rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-2)] p-3.5 text-xs sm:text-sm font-body text-[var(--text)] placeholder-[var(--text-muted)] leading-relaxed resize-none focus:outline-none focus:border-[var(--partner-a)]"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-chunky font-bold text-[var(--text)] mb-1 uppercase tracking-wide">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="Gratitude, Reflections, Goals, Memory..."
                  value={entryTagInput}
                  onChange={(e) => setEntryTagInput(e.target.value)}
                  className="w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none"
                />
              </div>

              {/* Privacy Footer */}
              <div className="pt-3 border-t-2 border-[var(--border)] flex items-center justify-between">
                <span className="text-[11px] font-ui text-emerald-600 flex items-center gap-1.5 font-bold">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Only saved to your profile</span>
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-ui text-[var(--text-muted)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-[var(--partner-a)] text-white font-chunky font-bold text-xs border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] active:translate-y-0.5 active:shadow-none cursor-pointer"
                  >
                    {editingEntry ? 'Update Entry' : 'Save Entry 🌸'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
