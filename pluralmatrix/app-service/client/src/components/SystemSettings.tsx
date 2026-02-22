import React, { useState, useEffect } from 'react';
import { X, Save, Settings, Hash } from 'lucide-react';
import { systemService } from '../services/api';

interface SystemSettingsProps {
    onSave: () => void;
    onCancel: () => void;
}

const SystemSettings: React.FC<SystemSettingsProps> = ({ onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        name: '',
        systemTag: '',
        slug: ''
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchSystem = async () => {
            try {
                const res = await systemService.get();
                setFormData({
                    name: res.data.name || '',
                    systemTag: res.data.systemTag || '',
                    slug: res.data.slug || ''
                });
            } catch (err) {
                alert('Failed to load system settings.');
            } finally {
                setLoading(false);
            }
        };
        fetchSystem();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await systemService.update(formData);
            onSave();
        } catch (err) {
            alert('Failed to save system settings.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-matrix-light border border-white/10 rounded-2xl shadow-2xl">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-matrix-primary/10 text-matrix-primary rounded-lg">
                                <Settings size={20} />
                            </div>
                            <h2 className="text-xl font-bold">System Settings</h2>
                        </div>
                        <button type="button" onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full text-matrix-muted transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-6 space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-matrix-muted mb-1">System Name</label>
                            <input 
                                className="matrix-input" 
                                value={formData.name} 
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })} 
                                placeholder="e.g. The Seraphim System"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-matrix-muted mb-1 flex items-center">
                                System Tag (Suffix)
                                <span className="ml-2 text-[10px] bg-white/5 px-1.5 py-0.5 rounded uppercase tracking-wider">Aesthetic</span>
                            </label>
                            <input 
                                className="matrix-input" 
                                value={formData.systemTag} 
                                onChange={(e) => setFormData({ ...formData, systemTag: e.target.value })} 
                                placeholder="e.g. ⛩️"
                            />
                            <p className="mt-1.5 text-xs text-matrix-muted italic">This will be appended to every member's display name.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-matrix-muted mb-1 flex items-center">
                                System Slug
                                <Hash size={12} className="ml-1 text-matrix-primary" />
                            </label>
                            <input 
                                className="matrix-input font-mono text-sm" 
                                value={formData.slug} 
                                onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} 
                                placeholder="e.g. seraphim"
                                required 
                            />
                            <p className="mt-1.5 text-xs text-matrix-muted">Used in your unique Ghost IDs (e.g. @_plural_<b>{formData.slug || 'slug'}</b>_member:server).</p>
                        </div>
                    </div>

                    <div className="p-6 border-t border-white/5 flex items-center justify-end space-x-4">
                        <button type="button" onClick={onCancel} className="matrix-button-outline">Cancel</button>
                        <button type="submit" disabled={saving} className="matrix-button flex items-center">
                            <Save size={18} className="mr-2" />
                            {saving ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SystemSettings;
