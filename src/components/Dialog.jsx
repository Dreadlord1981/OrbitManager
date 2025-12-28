import React from "react";

/**
 * Modern Dialog component for OrbitManager
 * @param {Object} props
 * @param {string} props.title - Title of the dialog
 * @param {string} props.message - Message content
 * @param {string} props.type - Type of dialog: 'info' | 'error' | 'confirm'
 * @param {function} props.onClose - Callback for closing (Cancel/Close)
 * @param {function} props.onConfirm - Callback for confirmation (only for type='confirm')
 */
export default function Dialog({ title, message, type = 'info', onClose, onConfirm }) {
	if (!title && !message) return null;

	const handleBackdropClick = (e) => {
		if (e.target.className === 'dialog-overlay') {
			onClose();
		}
	};

	const getIcon = () => {
		switch (type) {
			case 'error': return '❌';
			case 'confirm': return '❓';
			case 'success': return '✅';
			default: return 'ℹ️';
		}
	};

	return (
		<div className="dialog-overlay" onClick={handleBackdropClick}>
			<div className="dialog-box">
				<div className="dialog-header">
					<span className="dialog-type-icon">{getIcon()}</span>
					<h3 className="dialog-title">{title || (type === 'error' ? 'Error' : 'Notification')}</h3>
				</div>

				<div className="dialog-body">
					<p className="dialog-message">{message}</p>
				</div>

				<div className="dialog-actions">
					{type === 'confirm' ? (
						<>
							<button className="btn" onClick={onClose}>Cancel</button>
							<button className="btn btn-primary" onClick={onConfirm}>Confirm</button>
						</>
					) : (
						<button className="btn btn-primary" onClick={onClose}>Close</button>
					)}
				</div>
			</div>
		</div>
	);
}
