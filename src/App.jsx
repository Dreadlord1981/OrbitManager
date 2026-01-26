import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Dashboard from "./components/Dashboard";
import ServerForm from "./components/ServerForm";
import LogViewer from "./components/LogViewer";
import ConfigEditor from "./components/ConfigEditor";
import Settings from "./components/Settings";
import Dialog from "./components/Dialog";
import { SettingsIcon, ArrowLeftIcon } from "./components/Icons";
import "./App.css";

function App() {
	const [view, setView] = useState("dashboard"); // dashboard, form, logs, config, settings
	const [editingServer, setEditingServer] = useState(null);
	const [viewingServer, setViewingServer] = useState(null);
	const [editingConfigFile, setEditingConfigFile] = useState(null);
	const [allLogs, setAllLogs] = useState({}); // { serverId: [logs] }

	// Dialog state
	const [dialog, setDialog] = useState({
		isOpen: false,
		title: "",
		message: "",
		type: "info",
		onConfirm: null,
	});

	const showDialog = useCallback(({ title, message, type = "info", onConfirm }) => {
		return new Promise((resolve) => {
			setDialog({
				isOpen: true,
				title,
				message,
				type,
				onConfirm: () => {
					if (onConfirm) onConfirm();
					setDialog(prev => ({ ...prev, isOpen: false }));
					resolve(true);
				},
				onClose: () => {
					setDialog(prev => ({ ...prev, isOpen: false }));
					resolve(false);
				}
			});
		});
	}, []);

	useEffect(() => {
		// Simulate loading or wait for app to be ready
		const timer = setTimeout(() => {
			invoke("close_splash");
		}, 2000);

		// Listen for logs globally to persist them
		const unlisten = listen("server-output", (event) => {
			const { id, line, stream } = event.payload;
			setAllLogs((prev) => {
				const serverLogs = prev[id] || [];
				return {
					...prev,
					[id]: [...serverLogs, { line, stream, time: new Date() }],
				};
			});
		});

		return () => {
			clearTimeout(timer);
			unlisten.then((f) => f());
		};
	}, []);

	const handleAdd = () => {
		setEditingServer(null);
		setView("form");
	};

	const handleEditConfig = (server) => {
		setEditingConfigFile(server);
		setView("config");
	};

	const handleEdit = (server) => {
		setEditingServer(server);
		setView("form");
	};

	const handleCopy = (server) => {
		// Creat copy with new ID (handled by form or empty)
		// and modified name
		const copy = { ...server, id: "", name: `${server.name} (Copy)` };
		setEditingServer(copy);
		setView("form");
	};

	const handleViewLogs = async (server) => {
		setViewingServer(server);
		setView("logs");

		// If no logs in memory yet, try to load from disk
		if (!allLogs[server.id]) {
			try {
				const history = await invoke("get_log_history", { id: server.id });
				setAllLogs((prev) => ({
					...prev,
					[server.id]: history,
				}));
			} catch (err) {
				console.error("Failed to load log history:", err);
			}
		}
	};

	const handleClearLogs = (serverId) => {
		// Clear logs for specific server from state
		setAllLogs((prev) => ({
			...prev,
			[serverId]: [],
		}));
	};

	return (
		<div className="app-container">
			<header className="header">
				<h1>Orbit Manager</h1>
				<div style={{ display: 'flex', gap: 8 }}>
					{view === "dashboard" && (
						<button className="btn btn-icon-only" onClick={() => setView("settings")} title="Application Settings">
							<SettingsIcon size={18} />
						</button>
					)}
					{view !== "dashboard" && (
						<button className="btn btn-icon-only" onClick={() => setView("dashboard")} title="Back to Dashboard">
							<ArrowLeftIcon size={18} />
						</button>
					)}
				</div>
			</header>

			<main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
				{view === "dashboard" && (
					<Dashboard
						onAdd={handleAdd}
						onEdit={handleEdit}
						onCopy={handleCopy}
						onViewLogs={handleViewLogs}
						onEditConfig={handleEditConfig}
						showDialog={showDialog}
					/>
				)}

				{view === "form" && (
					<ServerForm
						initialData={editingServer}
						onSave={() => setView("dashboard")}
						onCancel={() => setView("dashboard")}
						showDialog={showDialog}
					/>
				)}

				{view === "logs" && viewingServer && (
					<LogViewer
						serverId={viewingServer.id}
						serverName={viewingServer.name}
						logs={allLogs[viewingServer.id] || []}
						onClose={() => setView("dashboard")}
						onClearLogs={handleClearLogs}
					/>
				)}

				{view === "config" && editingConfigFile && (
					<ConfigEditor
						serverId={editingConfigFile.id}
						serverName={editingConfigFile.name}
						onClose={() => setView("dashboard")}
						showDialog={showDialog}
					/>
				)}

				{view === "settings" && (
					<Settings onClose={() => setView("dashboard")} showDialog={showDialog} />
				)}
			</main>

			{dialog.isOpen && (
				<Dialog
					title={dialog.title}
					message={dialog.message}
					type={dialog.type}
					onClose={dialog.onClose}
					onConfirm={dialog.onConfirm}
				/>
			)}
		</div>
	);
}

export default App;
