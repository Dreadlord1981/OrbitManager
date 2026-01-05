import React, { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export default function LogViewer({ serverId, serverName, logs, onClose, onClearLogs }) {
	const bottomRef = useRef(null);

	useEffect(() => {
		// Scroll to bottom on new log
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [logs]);

	const handleClearLogs = async () => {
		try {
			await invoke("clear_logs", { id: serverId });
			// Notify parent to clear logs in state
			if (onClearLogs) {
				onClearLogs(serverId);
			}
		} catch (e) {
			console.error("Failed to clear logs:", e);
			alert(`Failed to clear logs: ${e}`);
		}
	};

	return (
		<div className="view-container">
			<div className="view-header">
				<h2>Logs: {serverName}</h2>
				<div style={{ display: 'flex', gap: 8 }}>
					<button className="btn" onClick={handleClearLogs} title="Clear Logs">
						🗑️ Clear
					</button>
					<button className="btn" onClick={onClose}>Close</button>
				</div>
			</div>
			<div className="terminal">
				{logs.length === 0 && <div style={{ opacity: 0.5 }}>Waiting for output...</div>}
				{logs.map((log, i) => (
					<div key={i} className={`log-line ${log.stream === 'stderr' ? 'log-err' : ''}`}>
						<span style={{ opacity: 0.5, marginRight: 8, fontSize: '0.9em' }}>
							[{log.time ? new Date(log.time).toLocaleTimeString() : 'History'}]
						</span>
						{log.line}
					</div>
				))}
				<div ref={bottomRef} />
			</div>
		</div>
	);
}
