import React, { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { TrashIcon } from "./Icons";

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
				<h3>Logs: {serverName}</h3>
				<div style={{ display: 'flex', gap: 12 }}>
					<button className="btn" onClick={handleClearLogs} title="Clear Terminal">
						<TrashIcon size={14} style={{ marginRight: '6px' }} /> Clear
					</button>
				</div>
			</div>
			<div className="terminal">
				{logs.length === 0 && <div style={{ opacity: 0.5, fontStyle: 'italic' }}>Waiting for output...</div>}
				{logs.map((log, i) => (
					<div key={i} className={`log-line ${log.stream === 'stderr' ? 'log-err' : ''}`}>
						<span style={{ opacity: 0.4, marginRight: 12, fontSize: '0.85em', fontWeight: 600 }}>
							{log.time ? new Date(log.time).toLocaleTimeString() : 'HISTORY'}
						</span>
						{log.line}
					</div>
				))}
				<div ref={bottomRef} style={{ height: '10px' }} />
			</div>
		</div>
	);
}
