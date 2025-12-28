import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
			// e.payload = { id, status }
			// We could just refresh list, or optimistically update.
			// Let's refresh list for simplicity to get latest state.
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
		<div className="view-content">
			<div className="server-list">
				<div className="list-header">
					<h2>Servers</h2>
					{servers.length > 0 && (
						<button className="btn btn-primary" onClick={onAdd}>+ Add Server</button>
					)}
				</div>

				{servers.length === 0 && (
					<div className="empty-state">
						<h3>No Servers Configured</h3>
						<p>Get started by adding your first server.</p>
						<button className="btn btn-primary" onClick={onAdd}>+ Add Server</button>
					</div>
				)}

				{servers.map((server) => (
					<div key={server.id} className="server-card">
						<div className="server-info">
							<div className="server-name">
								<span className={`status-indicator ${server.running ? 'status-running' : 'status-stopped'}`}
									title={server.running ? "Running" : "Stopped"} />
								{server.name}
							</div>
							<div className="server-details">{server.path}</div>
							{server.running && server.address && server.address !== "—" && (
								<div className="server-details" style={{ opacity: 0.85, color: 'var(--success-color)' }}>
									🌐 {server.address}
								</div>
							)}
							<div className="server-details" style={{ opacity: 0.7 }}>Config: {server.config_path}</div>
						</div>

						<div className="card-actions">
							{!server.running ? (
								<button className="btn" onClick={() => handleStart(server.id)} title="Start">
									▶️
								</button>
							) : (
								<button className="btn" onClick={() => handleStop(server.id)} title="Stop">
									⏹️
								</button>
							)}

							<button
								className="btn"
								onClick={() => handleOpenBrowser(server.id)}
								title={server.running ? "Open in Browser" : "Server must be running"}
								disabled={!server.running}
							>
								🌐
							</button>

							<button className="btn" onClick={() => onViewLogs(server)} title="Logs">
								📄
							</button>

							<button className="btn" onClick={() => onEdit(server)} title="Edit Configuration">
								✏️
							</button>
							<button className="btn" onClick={() => onEditConfig(server)} title="Edit Config File">
								📝
							</button>
							<button className="btn" onClick={() => handleOpenFolder(server.id)} title="Open Folder">
								📂
							</button>
							<button className="btn" onClick={() => onCopy(server)} title="Copy">
								📋
							</button>
							<button className="btn" onClick={() => handleDelete(server.id)} title="Delete">
								🗑️
							</button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
