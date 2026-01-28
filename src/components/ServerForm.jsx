import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftIcon, CheckIcon } from "./Icons";

export default function ServerForm({ initialData, onSave, onCancel }) {
	const [formData, setFormData] = useState({
		id: "", // Will be generated if empty
		name: "",
		path: "",
		config_path: "",
		auto_start: false,
		verbose: false,
	});

	useEffect(() => {
		if (initialData) {
			setFormData({
				...initialData,
				verbose: !!initialData.verbose // Ensure it's never undefined
			});
		} else {
			// Generate a random ID for new entry or let backend handle?
			// Let's generate a simple timestamp-based ID here for now
			setFormData(prev => ({ ...prev, id: Date.now().toString() }));
		}
	}, [initialData]);

	const handleChange = (e) => {
		const { name, value, type, checked } = e.target;
		setFormData((prev) => ({
			...prev,
			[name]: type === "checkbox" ? checked : value,
		}));
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		if (!formData.name || !formData.path) {
			showDialog({
				title: "Validation Error",
				message: "Name and Path are required to save a server configuration.",
				type: "error"
			});
			return;
		}

		// Check config path default
		const dataToSave = { ...formData };
		if (!dataToSave.config_path.trim()) {
			dataToSave.config_path = "webconfig.toml"; // Default as per requirements
		}

		try {
			await invoke("save_server", { config: dataToSave });
			onSave();
		} catch (err) {
			console.error("Failed to save:", err);
			showDialog({
				title: "Save Error",
				message: "Failed to save server configuration: " + err,
				type: "error"
			});
		}
	};

	return (
		<div className="view-container">
			<div className="view-header">
				<h3>{initialData ? "Edit Server Configuration" : "Create New Server"}</h3>
			</div>
			<div className="view-content">
				<div className="form-container">
					<form onSubmit={handleSubmit}>
						<div className="form-group">
							<label>Display Name</label>
							<input
								className="form-input"
								name="name"
								value={formData.name}
								onChange={handleChange}
								placeholder="e.g. Production Backend"
							/>
						</div>

						<div className="form-group">
							<label>Project Root Path</label>
							<input
								className="form-input"
								name="path"
								value={formData.path}
								onChange={handleChange}
								placeholder="C:\Work\my-project"
							/>
						</div>

						<div className="form-group">
							<label>Configuration Filename</label>
							<input
								className="form-input"
								name="config_path"
								value={formData.config_path}
								onChange={handleChange}
								placeholder="webconfig.toml"
							/>
						</div>

						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
							<div className="checkbox-group" style={{ marginBottom: 0 }}>
								<input
									type="checkbox"
									name="auto_start"
									checked={formData.auto_start}
									onChange={handleChange}
									id="auto_start"
								/>
								<label htmlFor="auto_start" style={{ marginBottom: 0, cursor: 'pointer', fontWeight: 600, fontSize: '11px' }}>
									Auto-start server
								</label>
							</div>

							<div className="checkbox-group" style={{ marginBottom: 0 }}>
								<input
									type="checkbox"
									name="verbose"
									checked={formData.verbose}
									onChange={handleChange}
									id="verbose"
								/>
								<label htmlFor="verbose" style={{ marginBottom: 0, cursor: 'pointer', fontWeight: 600, fontSize: '11px' }}>
									Verbose output
								</label>
							</div>
						</div>

						<div className="form-actions">
							<button type="button" className="btn" onClick={onCancel}>
								<ArrowLeftIcon size={14} /> Cancel
							</button>
							<button type="submit" className="btn btn-primary">
								<CheckIcon size={14} /> {initialData ? "Save Changes" : "Create Server"}
							</button>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
