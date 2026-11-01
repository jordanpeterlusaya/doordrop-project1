/**
 * Dedicated shipment management page — full A–Z view for a single order.
 */

import {
  buildOpsTimeline,
  buildShipmentMilestoneProgress,
  DELIVERY_TYPES,
  formatDelay,
  formatOpsDateTime,
  getCurrentOpsStageId,
  getDeliveryType,
  getNextOpsAction,
  getOpsStageDelay,
  getOpsStageLabel,
  getOrderEtaLabel,
  getResponsibleTeam,
  SHIPMENT_LIFECYCLE,
} from './ops-workflow.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pill(label, tone = 'info') {
  return `<span class="pill ${esc(tone)}">${esc(label)}</span>`;
}

function detailRow(label, value, fallback = '—') {
  const text = String(value ?? '').trim();
  return `<div class="detail-row"><label>${esc(label)}</label><p>${esc(text || fallback)}</p></div>`;
}

function formatDeclaredValue(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  return `TZS ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function renderLifecycleBar(progress) {
  return `
    <div class="shipment-lifecycle" role="list" aria-label="Shipment lifecycle">
      ${progress.map((step, index) => {
        const stateClass = step.state === 'complete' ? 'done' : step.state === 'current' ? 'current' : step.state === 'exception' ? 'exception' : '';
        return `
          <div class="shipment-milestone ${stateClass}" role="listitem" title="${esc(step.label)}">
            <div class="shipment-milestone-dot">${step.state === 'complete' ? '✓' : index + 1}</div>
            <span class="shipment-milestone-label">${esc(step.shortLabel || step.label)}</span>
            ${step.completedAt ? `<span class="shipment-milestone-time">${esc(formatOpsDateTime(step.completedAt))}</span>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderAttentionBanner(order, delay, attention) {
  if (!delay.overdue && !attention) return '';
  const message = attention?.message
    || (delay.overdue ? `Overdue in current stage by ${formatDelay(delay.delayMs)}` : '');
  const tone = attention?.priority === 'critical' || delay.delayMs >= 2 * 60 * 60 * 1000 ? 'danger' : 'warning';
  return `
    <div class="shipment-alert ${tone}">
      <strong>${tone === 'danger' ? 'Critical attention' : 'Needs attention'}</strong>
      <p>${esc(message)}</p>
      ${attention?.nextAction?.label ? `<span class="mini">Next: ${esc(attention.nextAction.label)} · ${esc(attention.responsibleTeam || '')}</span>` : ''}
    </div>
  `;
}

function renderTransportCard(order) {
  if (getDeliveryType(order) !== DELIVERY_TYPES.INTER_REGION) {
    return '';
  }
  return `
    <article class="card shipment-side-card">
      <div class="card-head"><div><span class="eyebrow">Transport</span><h3>Carrier & routing</h3></div></div>
      <div class="detail-list">
        ${detailRow('Mode', order.outsideShippingMode === 'express' ? 'Air / Express' : 'Bus')}
        ${detailRow('Handoff', order.outsideHandoffMode === 'home' ? 'Home delivery' : order.outsideHandoffMode === 'airport' ? 'Airport hub' : 'Bus stand')}
        ${detailRow('Origin', order.outsideOriginCity)}
        ${detailRow('Destination', order.outsideDestinationCity)}
        ${detailRow('Stand / airport', order.outsideDestinationStand || order.outsideDestinationLabel)}
        ${detailRow('Carrier reference', order.carrierRef)}
        ${detailRow('Departed', formatOpsDateTime(order.departedAt))}
        ${detailRow('Express flight', order.outsideExpressDepartureLabel || order.outsideExpressFlightLabel)}
        ${detailRow('Weight', order.outsideParcelWeightKg ? `${order.outsideParcelWeightKg} kg` : '')}
        ${detailRow('Declared value', formatDeclaredValue(order.declaredValueTzs))}
        ${detailRow('Legal declaration', order.contentsDeclarationAccepted === true ? 'Accepted by sender' : 'Not recorded')}
        ${detailRow('Parcel code', order.parcelCode || order.trackingId)}
      </div>
    </article>
  `;
}

function renderPaymentCard(order, formatMoney) {
  const amount = formatMoney ? formatMoney(order) : esc(order.totalLabel || order.fareLabel || '—');
  return `
    <article class="card shipment-side-card">
      <div class="card-head"><div><span class="eyebrow">Payment</span><h3>Billing</h3></div></div>
      <div class="detail-list">
        ${detailRow('Amount', amount)}
        ${detailRow('Payment status', order.paymentStatus || order.paidAt ? 'Paid' : 'Pending')}
        ${detailRow('Method', order.paymentMethod || order.paymentProvider)}
        ${detailRow('Transaction ref', order.paymentReference || order.mpesaReceipt)}
        ${detailRow('Paid at', formatOpsDateTime(order.paidAt))}
      </div>
    </article>
  `;
}

function renderProofCard(order) {
  const pod = order.proofOfDelivery || order.deliveryProof;
  const photo = order.deliveryPhotoUrl || order.podPhotoUrl;
  if (!pod && !photo && order.logisticsStatus !== 'completed' && order.status !== 'delivered') {
    return '';
  }
  return `
    <article class="card shipment-side-card">
      <div class="card-head"><div><span class="eyebrow">Proof of delivery</span><h3>Completion</h3></div></div>
      <div class="detail-list">
        ${detailRow('Delivered at', formatOpsDateTime(order.deliveredAt))}
        ${detailRow('Received by', order.recipientName)}
        ${detailRow('Notes', pod?.note || order.deliveryNote)}
        ${photo ? `<div class="detail-row"><label>Photo</label><p><a href="${esc(photo)}" target="_blank" rel="noopener">View proof</a></p></div>` : ''}
      </div>
    </article>
  `;
}

function renderAuditLog(order) {
  const log = Array.isArray(order.opsActivityLog) ? [...order.opsActivityLog].reverse() : [];
  if (!log.length) {
    return '<p class="muted">No manual audit entries yet.</p>';
  }
  return `
    <div class="shipment-audit-log">
      ${log.map((entry) => `
        <div class="shipment-audit-row">
          <div class="list-head">
            <strong>${esc(entry.type === 'manual_status_change' ? 'Manual override' : 'Status change')}</strong>
            <span class="mini">${esc(formatOpsDateTime(entry.at))}</span>
          </div>
          <p class="muted">${esc(getOpsStageLabel(entry.from, entry.deliveryType))} → ${esc(getOpsStageLabel(entry.to, entry.deliveryType))}</p>
          <span class="mini">By ${esc(entry.by || 'system')}${entry.reason ? ` · Reason: ${esc(entry.reason)}` : ''}</span>
          ${entry.note ? `<p class="mini">${esc(entry.note)}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderActionButtons(order, next) {
  const buttons = [];
  if (next.action) {
    const action = next.action === 'outside-assign' ? 'open-ops-desk' : next.action;
    buttons.push(`<button class="btn primary" type="button" data-action="${esc(action)}" data-order-id="${esc(order.id)}">${esc(next.label)}</button>`);
  }
  buttons.push(`<button class="btn soft" type="button" data-change-ops-status="${esc(order.id)}">Override status</button>`);
  if (getDeliveryType(order) !== DELIVERY_TYPES.INTER_REGION) {
    buttons.push(`<button class="btn soft" type="button" data-open-order-drawer="${esc(order.id)}">Dispatch drawer</button>`);
  }
  return buttons.join('');
}

/**
 * @param {object} order
 * @param {object} ctx
 */
export function renderShipmentManagementPage(order, ctx = {}) {
  if (!order) {
    return `<article class="card">${esc('Shipment not found. Return to Orders or search by ID.')}</article>`;
  }

  const delay = getOpsStageDelay(order, ctx.slaOverrides || {});
  const next = getNextOpsAction(order);
  const type = getDeliveryType(order);
  const stageId = getCurrentOpsStageId(order);
  const progress = buildShipmentMilestoneProgress(order);
  const timeline = buildOpsTimeline(order);
  const orderNumber = ctx.getOrderNumber ? ctx.getOrderNumber(order) : order.orderNumber || order.id;
  const statusLabel = ctx.getOrderStatusLabel ? ctx.getOrderStatusLabel(order) : getOpsStageLabel(stageId, type);
  const returnPage = ctx.returnPage || (type === DELIVERY_TYPES.INTER_REGION ? 'otherRegions' : 'orders');
  const returnLabel = returnPage === 'otherRegions' ? 'Bus & air parcels' : returnPage === 'orders' ? 'Orders' : 'Back';
  const outsideOpsHtml =
    type === DELIVERY_TYPES.INTER_REGION && typeof ctx.renderOutsideDetail === 'function'
      ? ctx.renderOutsideDetail(order)
      : '';

  return `
    <div class="shipment-page">
      <div class="shipment-page-toolbar">
        <button class="btn soft" type="button" data-page-jump="${esc(returnPage)}">← ${esc(returnLabel)}</button>
        <div class="admin-inline-actions">
          <button class="btn soft" type="button" data-open-timeline="${esc(order.id)}">Full timeline</button>
          <button class="btn soft" type="button" data-copy-value="${esc(order.id)}">Copy ID</button>
        </div>
      </div>

      <header class="shipment-hero card">
        <div class="shipment-hero-main">
          <span class="eyebrow">${type === DELIVERY_TYPES.INTER_REGION ? 'Bus / air parcel' : 'Local delivery'}</span>
          <h2 class="shipment-title">${esc(orderNumber)}</h2>
          <p class="muted">${esc(ctx.getPickup ? ctx.getPickup(order) : '')} → ${esc(ctx.getDropoff ? ctx.getDropoff(order) : '')}</p>
          <div class="shipment-hero-badges">
            ${pill(statusLabel, delay.overdue ? 'danger' : 'info')}
            ${pill(getResponsibleTeam(order), 'soft')}
            ${order.parcelCode ? pill(order.parcelCode, 'success') : ''}
            ${order.outsideShippingMode === 'express' ? pill('Ndege', 'info') : type === DELIVERY_TYPES.INTER_REGION ? pill('Basi', 'soft') : ''}
          </div>
        </div>
        <div class="shipment-hero-metrics">
          <div class="quick-card"><span>Stage since</span><strong>${esc(formatOpsDateTime(delay.startedAt))}</strong></div>
          <div class="quick-card"><span>Expected by</span><strong>${delay.expectedAt ? esc(formatOpsDateTime(delay.expectedAt)) : '—'}</strong></div>
          <div class="quick-card"><span>Customer ETA</span><strong>${esc(getOrderEtaLabel(order))}</strong></div>
          <div class="quick-card"><span>Declared value</span><strong>${esc(formatDeclaredValue(order.declaredValueTzs) || '—')}</strong></div>
        </div>
      </header>

      ${renderAttentionBanner(order, delay, ctx.attentionItem)}

      <section class="card shipment-lifecycle-card">
        <div class="card-head"><div><span class="eyebrow">Lifecycle</span><h3>Shipment progress</h3></div></div>
        ${renderLifecycleBar(progress)}
      </section>

      <section class="card shipment-next-action">
        <div class="card-head">
          <div>
            <span class="eyebrow">Next required action</span>
            <h3>${esc(next.label)}</h3>
            <p class="muted">Responsible: ${esc(next.team || getResponsibleTeam(order))} · Customer app updates when you change status</p>
          </div>
          <div class="admin-inline-actions">${renderActionButtons(order, next)}</div>
        </div>
      </section>

      ${
        outsideOpsHtml
          ? `<section class="card">
              <div class="card-head"><div><span class="eyebrow">Operations desk</span><h3>Hatua, QR, na status</h3></div></div>
              ${outsideOpsHtml}
            </section>`
          : ''
      }

      <div class="grid shipment-grid-two">
        <article class="card">
          <div class="card-head"><div><span class="eyebrow">Activity</span><h3>Complete timeline</h3></div></div>
          <div class="ops-vertical-timeline">
            ${timeline.length
              ? timeline.map((item, index) => `
                <div class="ops-timeline-node">
                  <div class="ops-timeline-dot">${timeline.length - index}</div>
                  <div class="ops-timeline-body">
                    <div class="list-head">
                      <strong>${esc(item.title)}</strong>
                      <span class="mini">${esc(formatOpsDateTime(item.at))}</span>
                    </div>
                    <p class="muted">${esc(item.detail || '—')}</p>
                    <span class="mini">${esc(item.by)}${item.reason ? ` · ${esc(item.reason)}` : ''}</span>
                  </div>
                </div>
              `).join('')
              : '<p class="muted">No events recorded yet.</p>'}
          </div>
        </article>

        <div class="shipment-side-stack">
          <article class="card shipment-side-card">
            <div class="card-head"><div><span class="eyebrow">Parties</span><h3>Contacts</h3></div></div>
            <div class="detail-list">
              ${detailRow('Sender', ctx.getCustomerName ? ctx.getCustomerName(order) : order.customerName)}
              ${detailRow('Sender phone', ctx.getCustomerContact ? ctx.getCustomerContact(order) : order.customerPhone)}
              ${detailRow('Recipient', ctx.getRecipientName ? ctx.getRecipientName(order) : order.recipientName)}
              ${detailRow('Recipient phone', ctx.getRecipientContact ? ctx.getRecipientContact(order) : order.recipientPhone)}
              ${detailRow('Assigned rider', order.driverName)}
              ${detailRow('Rider phone', order.driverPhone)}
            </div>
          </article>
          ${renderTransportCard(order)}
          ${renderPaymentCard(order, ctx.formatMoney)}
          ${renderProofCard(order)}
        </div>
      </div>

      <article class="card">
        <div class="card-head"><div><span class="eyebrow">Audit trail</span><h3>Status change history</h3></div>${pill('Immutable log', 'soft')}</div>
        ${renderAuditLog(order)}
      </article>
    </div>
  `;
}

export { SHIPMENT_LIFECYCLE };
