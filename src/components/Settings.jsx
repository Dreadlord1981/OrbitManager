import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";

export default function Settings({ onClose, showDialog }) {
	const [settings, setSettings] = useState({
		autostart: false,
		startHidden: false,
		lastModified: null,
	});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [version, setVersion] = useState("");

	// Helper to format timestamp
	const formatTimestamp = (timestamp) => {
		if (!timestamp) return '';
		const date = new Date(timestamp);
		return date.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	};

	useEffect(() => {
		async function loadSettings() {
			try {
				const s = await invoke("get_app_settings");

				let autostartEnabled = false;
				try {
					autostartEnabled = await isEnabled();
				} catch (e) {
					autostartEnabled = s.autostart || false;
				}

				setSettings({
					autostart: !!autostartEnabled,
					startHidden: !!s.startHidden,
					lastModified: s.lastModified || null,
				});

				try {
					const v = await getVersion();
					setVersion(v);
				} catch (e) {
					console.error("Failed to get app version:", e);
				}
			} catch (err) {
				console.error("Failed to load settings:", err);
				if (showDialog) {
					showDialog({
						title: "Settings Error",
						message: "Failed to load application settings: " + err,
						type: "error"
					});
				}
			} finally {
				setLoading(false);
			}
		}
		loadSettings();
	}, [showDialog]);

	const handleToggle = (name) => {
		const newValue = !settings[name];
		const newSettings = { ...settings, [name]: newValue };

		// Update UI immediately
		setSettings(newSettings);

		setSaving(true);
		(async () => {
			try {
				if (name === 'autostart') {
					if (newValue) await enable();
					else await disable();
				}

				await invoke("save_app_settings", { settings: newSettings });

				// Reload settings to get the updated timestamp
				const s = await invoke("get_app_settings");
				setSettings(prev => ({
					...prev,
					lastModified: s.lastModified
				}));
			} catch (err) {
				console.error("Failed to save setting:", err);
				if (showDialog) {
					showDialog({
						title: "Save Error",
						message: "Failed to save application setting: " + err,
						type: "error"
					});
				}
				// Revert on failure
				setSettings(prev => ({ ...prev, [name]: !newValue }));
			} finally {
				setSaving(false);
			}
		})();
	};

	if (loading) return <div className="view-container" style={{ padding: '24px' }}>Loading...</div>;

	return (
		<div className="view-container">
			<div className="view-header">
				<h3>Application Settings</h3>
			</div>

			<div className="view-content" style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
				<div className="settings-section" style={{ marginTop: '12px' }}>
					<div className="settings-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
						<div style={{ paddingRight: '24px' }}>
							<div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '4px' }}>Start with System</div>
							<div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
								Launch Orbit Manager automatically when you log in to your machine.
							</div>
						</div>
						<label className="orbit-switch">
							<input
								type="checkbox"
								checked={!!settings.autostart}
								onChange={() => handleToggle('autostart')}
								disabled={saving}
							/>
							<span className="orbit-slider"></span>
						</label>
					</div>

					<div className="settings-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
						<div style={{ paddingRight: '24px' }}>
							<div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '4px' }}>Start Hidden</div>
							<div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
								Minimize to tray on startup without showing the main window.
							</div>
						</div>
						<label className="orbit-switch">
							<input
								type="checkbox"
								checked={!!settings.startHidden}
								onChange={() => handleToggle('startHidden')}
								disabled={saving}
							/>
							<span className="orbit-slider"></span>
						</label>
					</div>
				</div>

				<div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '12px', textAlign: 'center' }}>
					<div style={{ fontWeight: 600 }}>Orbit Manager v{version || '...'}</div>
					<div style={{ marginTop: '4px' }}>Settings are stored locally on your system.</div>
					{settings.lastModified && (
						<div
							style={{
								marginTop: '16px',
								color: 'var(--success-color)',
								fontWeight: 700,
								textTransform: 'uppercase',
								letterSpacing: '0.05em'
							}}
						>
							Last saved {formatTimestamp(settings.lastModified)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
