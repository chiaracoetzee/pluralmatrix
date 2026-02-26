import React, { useState } from 'react';
import { X, Save, Plus, Trash2, Camera } from 'lucide-react';
import { memberService } from '../services/api';
import { getAvatarUrl } from '../utils/matrix';

interface MemberEditorProps {
    member?: any;
    onSave: () => void;
    onCancel: () => void;
}

const MemberEditor: React.FC<MemberEditorProps> = ({ member, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        slug: member?.slug || '',
        name: member?.name || '',
        displayName: member?.displayName || '',
        pronouns: member?.pronouns || '',
        description: member?.description || '',
        color: member?.color || '0dbd8b',
        avatarUrl: member?.avatarUrl || '',
        proxyTags: member?.proxyTags || [{ prefix: '', suffix: '' }]
    });
    const [loading, setLoading] = useState(false);

    const handleAddTag = () => {
        setFormData({ ...formData, proxyTags: [...formData.proxyTags, { prefix: '', suffix: '' }] });
    };

    const handleRemoveTag = (index: number) => {
        const newTags = formData.proxyTags.filter((_: any, i: number) => i !== index);
        setFormData({ ...formData, proxyTags: newTags });
    };

    const handleTagChange = (index: number, field: string, value: string) => {
        const newTags = [...formData.proxyTags];
        newTags[index][field] = value;
        setFormData({ ...formData, proxyTags: newTags });
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setLoading(true);
            try {
                const res = await memberService.uploadMedia(e.target.files[0]);
                setFormData({ ...formData, avatarUrl: res.data.content_uri });
            } catch (err) {
                alert('Avatar upload failed.');
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (member?.id) {
                await memberService.update(member.id, formData);
            } else {
                await memberService.create(formData);
            }
            onSave();
        } catch (err) {
            alert('Failed to save member.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="max-w-2xl w-full bg-matrix-light border border-white/10 rounded-2xl shadow-2xl my-8">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b border-white/5 flex items-center justify-between">
                        <h2 className="text-2xl font-bold">{member ? 'Edit System Member' : 'New System Member'}</h2>
                        <button type="button" onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-8 space-y-8">
                        {/* Basic Info */}
                        <div className="flex flex-col md:flex-row gap-8">
                            <div className="space-y-4 flex-shrink-0">
                                <div className="relative group w-32 h-32 rounded-2xl overflow-hidden bg-matrix-dark border-2 border-dashed border-white/10 flex items-center justify-center">
                                    {formData.avatarUrl && getAvatarUrl(formData.avatarUrl) ? (
                                        <img src={getAvatarUrl(formData.avatarUrl)!} className="w-full h-full object-cover" alt="Avatar" />
                                    ) : (
                                        <Camera className="text-matrix-muted" size={32} />
                                    )}
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        onChange={handleAvatarUpload}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                    />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none text-xs font-medium">
                                        Change Photo
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-matrix-muted mb-1">Color</label>
                                    <div className="flex items-center space-x-2">
                                        <input 
                                            type="color" 
                                            value={`#${formData.color.replace('#', '')}`}
                                            onChange={(e) => setFormData({ ...formData, color: e.target.value.replace('#', '') })}
                                            className="w-8 h-8 rounded cursor-pointer bg-transparent border-none"
                                        />
                                        <span className="text-xs font-mono">#{formData.color}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-matrix-muted mb-1">Short ID (for commands)</label>
                                    <input 
                                        className="matrix-input font-mono text-sm" 
                                        value={formData.slug} 
                                        onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} 
                                        placeholder="e.g. lily"
                                        required 
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-matrix-muted mb-1">Internal Name</label>
                                        <input 
                                            className="matrix-input" 
                                            value={formData.name} 
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })} 
                                            placeholder="e.g. Lily"
                                            required 
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-matrix-muted mb-1">Display Name (Override)</label>
                                        <input 
                                            className="matrix-input" 
                                            value={formData.displayName} 
                                            onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} 
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-matrix-muted mb-1">Pronouns</label>
                                    <input 
                                        className="matrix-input" 
                                        value={formData.pronouns} 
                                        onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })} 
                                        placeholder="e.g. She/Her"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-matrix-muted mb-1">Description / Lore</label>
                            <textarea 
                                className="matrix-input h-32 resize-none" 
                                value={formData.description} 
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })} 
                                placeholder="Tell us about them..."
                            />
                        </div>

                        {/* Proxy Tags */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold flex items-center">
                                    Proxy Tags
                                    <span className="ml-2 text-xs font-normal text-matrix-muted uppercase tracking-wider">Prefix/Suffix</span>
                                </h3>
                                <button 
                                    type="button" 
                                    onClick={handleAddTag}
                                    className="text-matrix-primary hover:text-matrix-secondary transition-colors flex items-center text-sm font-medium"
                                >
                                    <Plus size={16} className="mr-1" /> Add Tag
                                </button>
                            </div>
                            
                            <div className="space-y-3">
                                {formData.proxyTags.map((tag: any, index: number) => (
                                    <div key={index} className="flex items-center space-x-3">
                                        <input 
                                            className="matrix-input" 
                                            placeholder="Prefix (e.g. l;)" 
                                            value={tag.prefix}
                                            onChange={(e) => handleTagChange(index, 'prefix', e.target.value)}
                                        />
                                        <div className="text-matrix-muted px-2">text</div>
                                        <input 
                                            className="matrix-input" 
                                            placeholder="Suffix (optional)" 
                                            value={tag.suffix}
                                            onChange={(e) => handleTagChange(index, 'suffix', e.target.value)}
                                        />
                                        <button 
                                            type="button"
                                            onClick={() => handleRemoveTag(index)}
                                            className="p-2 text-matrix-muted hover:text-red-400 transition-colors"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="p-6 border-t border-white/5 flex items-center justify-end space-x-4">
                        <button 
                            type="button" 
                            onClick={onCancel}
                            className="matrix-button-outline"
                        >
                            Cancel
                        </button>
                                                <button type="submit" disabled={loading} className="matrix-button flex items-center">
                                                    <Save size={18} className="mr-2" />
                                                    {loading ? 'Saving...' : 'Save System Member'}
                                                </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default MemberEditor;
