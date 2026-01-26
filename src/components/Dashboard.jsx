import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	PlayIcon, StopIcon, ExternalLinkIcon, LogsIcon,
	SettingsIcon, ConfigIcon, FolderIcon, CopyIcon,
	TrashIcon, PlusIcon
} from "./Icons";

export default function Dashboard({ onAdd, onEdit, onCopy, onViewLogs, onEditConfig, showDialog }) {
	const [servers, setServers] = useState([]);

	const refreshServers = async () => {
		try {
			const list = await invoke("get_servers");
			setServers(list);
		} catch (e) {
			console.error(e);
		}
	};

	useEffect(() => {
		refreshServers();

		// Listen to status changes to update UI
		const unlisten = listen("server-status", (e) => {
			refreshServers();
		});

		return () => {
			unlisten.then(f => f());
		}
	}, []);

	const handleStart = async (id) => {
		try {
			await invoke("start_server", { id });
			refreshServers();
		} catch (e) {
			showDialog({
				title: "Start Error",
				message: e.toString(),
				type: "error"
			});
		}
	};

	const handleStop = async (id) => {
		try {
			await invoke("stop_server", { id });
			refreshServers();
		} catch (e) {
			showDialog({
				title: "Stop Error",
				message: e.toString(),
				type: "error"
			});
		}
	};

	const handleDelete = async (id) => {
		const confirmed = await showDialog({
			title: "Delete Configuration",
			message: "Are you sure you want to delete this server configuration? This action cannot be undone.",
			type: "confirm"
		});

		if (confirmed) {
			try {
				await invoke("delete_server", { id });
				refreshServers();
			} catch (e) {
				showDialog({
					title: "Delete Error",
					message: e.toString(),
					type: "error"
				});
			}
		}
	};

	const handleOpenFolder = async (id) => {
		try {
			await invoke("open_in_explorer", { id });
		} catch (e) {
			showDialog({
				title: "Explorer Error",
				message: e.toString(),
				type: "error"
			});
		}
	};

	const handleOpenBrowser = async (id) => {
		try {
			await invoke("open_server_browser", { id });
		} catch (e) {
			showDialog({
				title: "Browser Error",
				message: e.toString(),
				type: "error"
			});
		}
	};

	return (
		<div className="view-container">
			<div className="view-header">
				<h2>Servers</h2>
				{servers.length > 0 && (
					<button className="btn btn-primary" onClick={onAdd}>
						<PlusIcon size={14} style={{ marginRight: '6px' }} /> Add Server
					</button>
				)}
			</div>

			<div className="view-content">
				<div className="server-list">
					{servers.length === 0 && (
						<div className="empty-state">
							<h3>No Servers Configured</h3>
							<p>Store and manage your local server configurations here.</p>
							<button className="btn btn-primary" onClick={onAdd} style={{ marginTop: '16px' }}>
								<PlusIcon size={14} style={{ marginRight: '6px' }} /> Configure First Server
							</button>
						</div>
					)}

					{servers.map((server) => (
						<div key={server.id} className="server-card">
							<div className="server-info">
								<div className="server-name">
									<span
										className={`status-indicator ${server.running ? 'status-running' : 'status-stopped'}`}
										title={server.running ? "Running" : "Stopped"}
									/>
									{server.name}
								</div>
								<div className="server-details">{server.path}</div>
								{server.running && server.address && server.address !== "—" && (
									<div className="server-details" style={{ color: 'var(--success-color)', opacity: 1, fontWeight: 700, marginTop: '4px' }}>
										{server.address}
									</div>
								)}
								<div className="server-details" style={{ marginTop: '4px' }}>Config: {server.config_path}</div>
							</div>

							<div className="card-actions">
								{!server.running ? (
									<button className="btn btn-icon-only" onClick={() => handleStart(server.id)} title="Start Server">
										<PlayIcon size={16} fill="currentColor" />
									</button>
								) : (
									<button className="btn btn-icon-only" style={{ color: 'var(--danger-color)' }} onClick={() => handleStop(server.id)} title="Stop Server">
										<StopIcon size={16} fill="currentColor" />
									</button>
								)}

								<button
									className="btn btn-icon-only"
									onClick={() => handleOpenBrowser(server.id)}
									title="Open in Browser"
									disabled={!server.running}
								>
									<ExternalLinkIcon size={16} />
								</button>

								<button className="btn btn-icon-only" onClick={() => onViewLogs(server)} title="View Logs">
									<LogsIcon size={16} />
								</button>

								<button className="btn btn-icon-only" onClick={() => onEdit(server)} title="Edit Settings">
									<SettingsIcon size={16} />
								</button>

								<button className="btn btn-icon-only" onClick={() => onEditConfig(server)} title="Edit Config File">
									<ConfigIcon size={16} />
								</button>

								<button className="btn btn-icon-only" onClick={() => handleOpenFolder(server.id)} title="Open Folder">
									<FolderIcon size={16} />
								</button>

								<button className="btn btn-icon-only" onClick={() => onCopy(server)} title="Copy Configuration">
									<CopyIcon size={16} />
								</button>

								<button className="btn btn-icon-only btn-danger" onClick={() => handleDelete(server.id)} title="Delete Server">
									<TrashIcon size={16} />
								</button>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
