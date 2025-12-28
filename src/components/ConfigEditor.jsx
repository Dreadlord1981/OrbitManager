import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import Editor from "@monaco-editor/react";

export default function ConfigEditor({ serverId, serverName, onClose, showDialog }) {
	const [content, setContent] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [hasErrors, setHasErrors] = useState(false);
	const [hasWarnings, setHasWarnings] = useState(false);
	const [theme, setTheme] = useState(window.matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "vs");
	const editorRef = useRef(null);
	const monacoRef = useRef(null);
	const providerRef = useRef(null);
	const validationTimeoutRef = useRef(null);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (e) => setTheme(e.matches ? "vs-dark" : "vs");
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	useEffect(() => {
		async function loadConfig() {
			try {
				const data = await invoke("read_config_file", { id: serverId });
				setContent(data);
			} catch (err) {
				showDialog({
					title: "Load Error",
					message: "Failed to read configuration file: " + err,
					type: "error"
				});
			} finally { setLoading(false); }
		}
		loadConfig();
	}, [serverId, showDialog]);

	useEffect(() => {
		return () => {
			if (providerRef.current) providerRef.current.dispose();
			if (validationTimeoutRef.current) clearTimeout(validationTimeoutRef.current);
		};
	}, []);

	const validate = (value, monaco, editor) => {
		if (!monaco || !editor) return;
		const markers = [];
		const lines = value.split(/\r?\n/);

		let currentSection = null;
		let serverProps = { address: false, port: false };
		let routeIndices = [];
		let hasServerSection = false;

		const allowedTags = ['[server]', '[[server.headers]]', '[[server.route]]'];
		const schema = {
			'server': { 'address': 'string', 'port': 'integer', 'cache': 'boolean', 'https': 'boolean', 'name': 'string' },
			'headers': { 'key': 'string', 'value': 'string' },
			'route': { 'path': 'string', 'ifs': 'string', 'address': 'string', 'https': 'boolean', 'strip': 'boolean' }
		};

		const isString = (val) => /^".*"$/.test(val) || /^'.*'$/.test(val);
		const isInteger = (val) => /^[+-]?\d+$/.test(val);
		const isBoolean = (val) => val === 'true' || val === 'false';

		// Robust section check
		hasServerSection = /^\s*\[\s*server\s*\]\s*(?:#.*)?$/m.test(value);

		lines.forEach((line, index) => {
			const lineContent = line.split('#')[0].trim();
			if (lineContent === '') return;

			if (lineContent.startsWith('[') && (lineContent.endsWith(']') || !lineContent.includes('='))) {
				const normalizedTag = lineContent.replace(/\s+/g, '');
				if (!allowedTags.includes(normalizedTag)) {
					if (lineContent.endsWith(']')) {
						markers.push({
							message: `Invalid section '${lineContent}'`,
							severity: monaco.MarkerSeverity.Error,
							startLineNumber: index + 1, startColumn: 1, endLineNumber: index + 1, endColumn: line.length + 1,
						});
					}
					currentSection = 'invalid';
				} else {
					if (normalizedTag === '[server]') currentSection = 'server';
					else if (normalizedTag === '[[server.headers]]') currentSection = 'headers';
					else if (normalizedTag === '[[server.route]]') { currentSection = 'route'; routeIndices.push(index); }
				}
				return;
			}

			if (currentSection && currentSection !== 'invalid' && lineContent.includes('=')) {
				const parts = lineContent.split('=');
				const propName = parts[0].trim();
				const propValue = parts.slice(1).join('=').trim();

				if (currentSection === 'server') {
					if (propName === 'address') serverProps.address = true;
					if (propName === 'port') serverProps.port = true;
				}

				const sectionSchema = schema[currentSection];
				if (sectionSchema && sectionSchema[propName]) {
					const expectedType = sectionSchema[propName];
					let isValid = true;
					if (expectedType === 'string' && !isString(propValue)) isValid = false;
					if (expectedType === 'integer' && !isInteger(propValue)) isValid = false;
					if (expectedType === 'boolean' && !isBoolean(propValue)) isValid = false;

					if (!isValid) {
						markers.push({
							message: `Expected ${expectedType} value`,
							severity: monaco.MarkerSeverity.Error,
							startLineNumber: index + 1, startColumn: line.indexOf('=') + 2, endLineNumber: index + 1, endColumn: line.length + 1,
						});
					}
				} else if (sectionSchema) {
					markers.push({
						message: `Unknown property '${propName}'`,
						severity: monaco.MarkerSeverity.Error,
						startLineNumber: index + 1, startColumn: 1, endLineNumber: index + 1, endColumn: propName.length + 1,
					});
				}
			}
		});

		if (!hasServerSection) {
			markers.push({ message: "[server] section is missing", severity: monaco.MarkerSeverity.Error, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 20 });
		} else {
			if (!serverProps.address) markers.push({ message: "address property is missing", severity: monaco.MarkerSeverity.Warning, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 20 });
			if (!serverProps.port) markers.push({ message: "port property is missing", severity: monaco.MarkerSeverity.Warning, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 20 });
		}

		routeIndices.forEach(idx => {
			let found = false;
			for (let i = idx + 1; i < lines.length && !lines[i].trim().match(/^\[{1,2}/); i++) {
				if (lines[i].trim().startsWith('path')) { found = true; break; }
			}
			if (!found) markers.push({ message: "path property is recommended", severity: monaco.MarkerSeverity.Warning, startLineNumber: idx + 1, startColumn: 1, endLineNumber: idx + 1, endColumn: 20 });
		});

		monaco.editor.setModelMarkers(editor.getModel(), "toml-validator", markers);
		setHasErrors(markers.some(m => m.severity === monaco.MarkerSeverity.Error));
		setHasWarnings(markers.some(m => m.severity === monaco.MarkerSeverity.Warning));
	};

	const debouncedValidate = (value, monaco, editor, delay = 150) => {
		if (validationTimeoutRef.current) clearTimeout(validationTimeoutRef.current);
		validationTimeoutRef.current = setTimeout(() => {
			validate(value, monaco, editor);
		}, delay);
	};

	function handleEditorDidMount(editor, monaco) {
		editorRef.current = editor;
		monacoRef.current = monaco;

		if (providerRef.current) providerRef.current.dispose();
		providerRef.current = monaco.languages.registerCompletionItemProvider('toml', {
			triggerCharacters: ['[', '.', '=', ' '],
			provideCompletionItems: (model, position) => {
				const line = model.getLineContent(position.lineNumber);
				const textUntilCursor = line.substring(0, position.column - 1);
				const word = model.getWordUntilPosition(position);

				let ctx = null;
				for (let i = position.lineNumber - 1; i >= 1; i--) {
					const l = model.getLineContent(i).split('#')[0].trim().replace(/\s+/g, '');
					if (l === '[server]') { ctx = 'server'; break; }
					if (l === '[[server.headers]]') { ctx = 'headers'; break; }
					if (l === '[[server.route]]') { ctx = 'route'; break; }
				}

				const suggestions = [];
				if (!textUntilCursor.includes('=')) {
					const tagRange = {
						startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
						startColumn: textUntilCursor.includes('[') ? line.indexOf('[') + 1 : word.startColumn,
						endColumn: position.column
					};
					const tag = (label) => suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Class, insertText: label, range: tagRange, sortText: '0' + label });
					tag('[server]'); tag('[[server.headers]]'); tag('[[server.route]]');
				}

				if (ctx && !textUntilCursor.includes('=')) {
					const prop = (label, snippet, sort) => suggestions.push({
						label, kind: monaco.languages.CompletionItemKind.Field, insertText: snippet,
						insertTextRules: monaco.languages.CompletionItemRules.InsertAsSnippet,
						range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn },
						sortText: '1' + sort
					});
					if (ctx === 'server') {
						prop('address', 'address = "${1:127.0.0.1}"', 'a');
						prop('port', 'port = ${1:7701}', 'b');
						prop('cache', 'cache = ${1:false}', 'c');
						prop('https', 'https = ${1:true}', 'd');
						prop('name', 'name = "${1}"', 'e');
					} else if (ctx === 'headers') {
						prop('key', 'key = "${1}"', 'a');
						prop('value', 'value = "${1}"', 'b');
					} else if (ctx === 'route') {
						prop('path', 'path = "${1:/}"', 'a');
						prop('ifs', 'ifs = "${1:./}"', 'b');
						prop('address', 'address = "${1}"', 'c');
						prop('https', 'https = ${1:false}', 'd');
						prop('strip', 'strip = ${1:false}', 'e');
					}
				}
				return { suggestions };
			}
		});

		// Delayed initial validation to allow Monaco to settle the model
		setTimeout(() => {
			validate(editor.getValue(), monaco, editor);
		}, 300);
	}

	return (
		<div className="config-editor-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
			<div className="logs-header" style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
				<h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Editing: {serverName} Config</h3>
				<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
					{hasErrors && <span style={{ color: '#ff4444', fontSize: '13px' }}>⚠️ Blocked: Fix Errors</span>}
					{!hasErrors && hasWarnings && <span style={{ color: '#ffcc00', fontSize: '13px' }}>⚠️ Suggestions Available</span>}
					<button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
					<button className="btn btn-primary" onClick={async () => {
						setSaving(true);
						try {
							await invoke("save_config_file", { id: serverId, content: editorRef.current.getValue() });
							onClose();
						} catch (err) {
							showDialog({
								title: "Save Error",
								message: "Failed to save configuration: " + err,
								type: "error"
							});
						} finally { setSaving(false); }
					}} disabled={saving || hasErrors}>
						{saving ? "Saving..." : "Save Changes"}
					</button>
				</div>
			</div>
			<div style={{ flex: 1 }}>
				<Editor
					height="100%" language="toml" theme={theme} value={content}
					onChange={(val) => {
						setContent(val);
						if (monacoRef.current && editorRef.current) debouncedValidate(val, monacoRef.current, editorRef.current);
					}}
					onMount={handleEditorDidMount}
					options={{
						minimap: { enabled: true },
						fontSize: 14,
						automaticLayout: true,
						wordBasedSuggestions: true,
						scrollBeyondLastLine: false,
						smoothScrolling: false,
						mouseWheelScrollSensitivity: 1,
						scrollbar: {
							vertical: 'visible',
							horizontal: 'auto',
							verticalScrollbarSize: 10,
							horizontalScrollbarSize: 10,
							useShadows: false
						}
					}}
				/>
			</div>
		</div>
	);
}
