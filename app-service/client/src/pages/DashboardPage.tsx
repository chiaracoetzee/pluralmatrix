import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { memberService, systemService } from '../services/api';
import MemberCard from '../components/MemberCard';
import MemberEditor from '../components/MemberEditor';
import ImportTool from '../components/ImportTool';
import SystemSettings from '../components/SystemSettings';
import { LogOut, Plus, Upload, Search, LayoutGrid, List, Trash2, Download, Image, ChevronDown, Database, Edit3 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const DashboardPage: React.FC = () => {
    const { user, logout } = useAuth();
    const [system, setSystem] = useState<any>(null);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [selectedMember, setSelectedMember] = useState<any>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isDataMenuOpen, setIsDataMenuOpen] = useState(false);

    const fetchMembers = async () => {
        try {
            const res = await memberService.list();
            const sorted = res.data.sort((a: any, b: any) => a.slug.localeCompare(b.slug));
            setMembers(sorted);
        } catch (e) {
            console.error('Failed to fetch members');
        } finally {
            setLoading(false);
        }
    };

    const fetchSystem = async () => {
        try {
            const res = await systemService.get();
            setSystem(res.data);
        } catch (e) {
            console.error('Failed to fetch system');
        }
    };

    useEffect(() => {
        fetchMembers();
        fetchSystem();
    }, []);

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this alter?')) {
            try {
                await memberService.delete(id);
                fetchMembers();
            } catch (e) {
                alert('Delete failed');
            }
        }
    };

    const handleDeleteAll = async () => {
        if (confirm('⚠️ WARNING: This will permanently delete ALL alters in your system. This cannot be undone. Are you absolutely sure?')) {
            try {
                await memberService.deleteAll();
                fetchMembers();
            } catch (e) {
                alert('Bulk delete failed');
            }
        }
    };

    const handleImportMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                setLoading(true);
                const res = await memberService.importMedia(e.target.files[0]);
                alert(`Successfully imported ${res.data.count} avatars!`);
                fetchMembers();
            } catch (err) {
                alert('Media import failed.');
            } finally {
                setLoading(false);
            }
        }
    };

    const filteredMembers = members.filter((m: any) => 
        m.name.toLowerCase().includes(search.toLowerCase()) || 
        m.slug.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="min-h-screen pb-20 text-matrix-text">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-matrix-dark/80 backdrop-blur-md border-b border-white/5">
                <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 rounded-xl bg-matrix-primary flex items-center justify-center font-bold text-xl">P</div>
                        <div>
                            <h1 className="font-bold text-xl leading-tight">PluralMatrix</h1>
                            <p className="text-matrix-muted text-xs font-medium">{user?.mxid}</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center space-x-4">
                        <button 
                            onClick={logout}
                            className="p-2 hover:bg-white/5 rounded-lg text-matrix-muted hover:text-white transition-colors flex items-center text-sm font-medium"
                        >
                            <LogOut size={18} className="mr-2" /> Sign Out
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 mt-12 space-y-12">
                {/* Hero / Stats */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div className="space-y-2">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3 group">
                                <h2 className="text-4xl font-bold tracking-tight text-white">
                                    {system?.name || "Your System"}
                                </h2>
                                <button 
                                    onClick={() => setIsSettingsOpen(true)}
                                    className="p-2 hover:bg-white/5 rounded-full text-matrix-muted hover:text-matrix-primary transition-colors"
                                    title="Edit System Settings"
                                >
                                    <Edit3 size={20} />
                                </button>
                            </div>
                            {system?.systemTag && (
                                <div className="text-xl font-normal text-matrix-muted/80 flex items-center">
                                    <span className="bg-white/5 px-2 py-0.5 rounded text-sm uppercase tracking-wider mr-2 text-xs font-bold">Suffix Tag</span>
                                    {system.systemTag}
                                </div>
                            )}
                        </div>
                        <p className="text-matrix-muted font-medium mt-4">You have {members.length} registered alters.</p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => { setSelectedMember(null); setIsEditing(true); }}
                            className="matrix-button flex items-center shadow-lg shadow-matrix-primary/20"
                        >
                            <Plus size={18} className="mr-2" /> Add Alter
                        </button>

                        <div className="relative">
                            <button 
                                onClick={() => setIsDataMenuOpen(!isDataMenuOpen)}
                                className="matrix-button-outline flex items-center"
                            >
                                <Database size={18} className="mr-2" /> Data <ChevronDown size={16} className={`ml-2 transition-transform ${isDataMenuOpen ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {isDataMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setIsDataMenuOpen(false)} />
                                        <motion.div 
                                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                            className="absolute right-0 mt-2 w-56 bg-matrix-light border border-white/10 rounded-xl shadow-2xl z-20 py-2 overflow-hidden"
                                        >
                                            <div className="px-4 py-2 text-[10px] font-bold text-matrix-muted uppercase tracking-wider">Export</div>
                                            <button 
                                                onClick={() => { memberService.exportPk(); setIsDataMenuOpen(false); }}
                                                className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center transition-colors"
                                            >
                                                <Download size={16} className="mr-3 text-matrix-primary" /> Export JSON (PK)
                                            </button>
                                            <button 
                                                onClick={() => { memberService.exportMedia(); setIsDataMenuOpen(false); }}
                                                className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center transition-colors"
                                            >
                                                <Image size={16} className="mr-3 text-matrix-primary" /> Export Avatars (ZIP)
                                            </button>

                                            <div className="h-px bg-white/5 my-2" />
                                            <div className="px-4 py-2 text-[10px] font-bold text-matrix-muted uppercase tracking-wider">Import</div>
                                            <button 
                                                onClick={() => { setIsImporting(true); setIsDataMenuOpen(false); }}
                                                className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center transition-colors"
                                            >
                                                <Upload size={16} className="mr-3 text-matrix-primary" /> Import JSON (PK)
                                            </button>
                                            <label className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center cursor-pointer transition-colors">
                                                <Upload size={16} className="mr-3 text-matrix-primary" /> Import Avatars (ZIP)
                                                <input type="file" accept=".zip" onChange={(e) => { handleImportMedia(e); setIsDataMenuOpen(false); }} className="hidden" />
                                            </label>

                                            <div className="h-px bg-white/5 my-2" />
                                            <div className="px-4 py-2 text-[10px] font-bold text-red-400 uppercase tracking-wider">Danger Zone</div>
                                            <button 
                                                onClick={() => { handleDeleteAll(); setIsDataMenuOpen(false); }}
                                                className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-400/10 text-red-400 flex items-center transition-colors"
                                            >
                                                <Trash2 size={16} className="mr-3" /> Delete All Alters
                                            </button>
                                        </motion.div>
                                    </>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Search & Filter */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-matrix-light p-4 rounded-2xl border border-white/5">
                    <div className="relative w-full md:max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-matrix-muted" size={18} />
                        <input 
                            className="matrix-input pl-12 bg-matrix-dark/50" 
                            placeholder="Search by name or ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center bg-matrix-dark/50 p-1 rounded-lg">
                        <button className="p-2 bg-matrix-light shadow-sm rounded-md text-matrix-primary"><LayoutGrid size={18} /></button>
                        <button className="p-2 text-matrix-muted hover:text-white transition-colors"><List size={18} /></button>
                    </div>
                </div>

                {/* Grid */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1,2,3,4,5,6].map(i => (
                            <div key={i} className="h-48 bg-matrix-light animate-pulse rounded-2xl border border-white/5" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <AnimatePresence mode="popLayout">
                            {filteredMembers.map((member: any) => (
                                <MemberCard 
                                    key={member.id} 
                                    member={member} 
                                    onEdit={(m) => { setSelectedMember(m); setIsEditing(true); }}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                )}

                {!loading && filteredMembers.length === 0 && (
                    <div className="text-center py-20 space-y-4">
                        <div className="w-20 h-20 bg-matrix-light rounded-full flex items-center justify-center mx-auto text-matrix-muted">
                            <Search size={40} />
                        </div>
                        <h3 className="text-xl font-bold">No alters found</h3>
                        <p className="text-matrix-muted max-w-xs mx-auto">Try a different search term or add your first alter using the button above.</p>
                    </div>
                )}
            </main>

            {/* Modals */}
            {isEditing && (
                <MemberEditor 
                    member={selectedMember} 
                    onSave={() => { setIsEditing(false); fetchMembers(); }}
                    onCancel={() => setIsEditing(false)}
                />
            )}

            {isImporting && (
                <ImportTool 
                    onComplete={() => { setIsImporting(false); fetchMembers(); }}
                    onCancel={() => setIsImporting(false)}
                />
            )}

            {isSettingsOpen && (
                <SystemSettings 
                    onSave={() => { setIsSettingsOpen(false); fetchMembers(); fetchSystem(); }}
                    onCancel={() => setIsSettingsOpen(false)}
                />
            )}
        </div>
    );
};

export default DashboardPage;
