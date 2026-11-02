import Link from "next/link";
import { Card, Chip, Notice, PageHeader, inputClass, linkButtonClass, secondaryButtonClass, type ChipTone } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { getDb, withUser } from "@/db/client";
import {
  CHANNEL_LABELS,
  INBOX_FILTERS,
  STATUS_LABELS,
  STEP_LABELS,
  VIA_LABELS,
  conversationActions,
  conversationGuide,
  conversationStep,
  displayName,
  isInboxFilter,
  isUnanswered,
  waitLabel,
  type ConversationStep,
  type InboundKind,
  type InboxFilter,
} from "@/domain/inbox";
import { firstParams, isUuid } from "@/domain/params";
import { formatPhone } from "@/domain/phone";
import { can } from "@/domain/permissions";
import { AppError } from "@/server/errors";
import { getConversation, inboxCounts, listConversations, listSavedReplies, memberEmails } from "@/server/inbox";
import { requireActiveAgency } from "@/server/session";
import { activeMembers } from "@/server/tasks";
import { Flash, describeActivity, fechaHora, type SearchParams } from "../crm-ui";
import { assignConversationAction, resolveConversationAction, takeConversationAction } from "../inbox-actions";
import { Composer } from "./composer";

const CHANNEL_ICON: Record<InboundKind, IconName> = { formulario: "form", chat: "message", correo: "mail" };
const CHANNEL_TONE: Record<InboundKind, string> = {
  formulario: "bg-violet-50 text-violet-800",
  chat: "bg-sky-50 text-sky-800",
  correo: "bg-amber-50 text-amber-900",
};
const STEP_ICON: Record<ConversationStep, IconName> = { tomar: "hand", responder: "send", esperando: "clock", crear_oportunidad: "plus", resuelta: "done" };

const EMPTY: Record<InboxFilter, string> = {
  sin_responder: "No hay conversaciones sin responder. ¡Vas al día! Las nuevas aparecen aquí cuando pasan el tiempo máximo sin respuesta.",
  mias: "No tienes conversaciones abiertas. Toma una de \"Sin asignar\" para empezar.",
  sin_asignar: "No hay conversaciones esperando responsable.",
  todas: "Aún no llegan mensajes. Comparte el enlace del formulario web de la agencia (Administración › Canales de entrada) para recibir consultas aquí.",
  resueltas: "Todavía no hay conversaciones resueltas.",
};

/**
 * Bandeja (SPEC-003): lista de conversaciones a la izquierda, la conversación en el centro y
 * "Qué hacer ahora" a la derecha. En el celular se ve la lista o la conversación.
 */
export default async function BandejaPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, active } = await requireActiveAgency();
  const sp = firstParams(await searchParams);
  const now = new Date();
  const db = getDb();
  const [counts0] = await withUser(db, user, (tx) => Promise.all([inboxCounts(tx, user.id, active.agencyId, now)]));
  // Por defecto: lo urgente si hay; si no, las mías (o todas para quien no tiene).
  const filter: InboxFilter = isInboxFilter(sp.f) ? sp.f : counts0.unansweredMine > 0 ? "sin_responder" : counts0.mine > 0 ? "mias" : "todas";
  const q = sp.q?.trim().slice(0, 100) ?? "";
  const selectedId = sp.c && isUuid(sp.c) ? sp.c : null;

  const [rows, members, replies, detail] = await withUser(db, user, async (tx) => {
    const d = selectedId
      ? await getConversation(tx, user.id, active.agencyId, selectedId).catch((e: unknown) => {
          if (e instanceof AppError && e.code === "not_found") return null;
          throw e;
        })
      : null;
    return Promise.all([
      listConversations(tx, user.id, active.agencyId, { filter, q, now }),
      activeMembers(tx, user.id, active.agencyId),
      listSavedReplies(tx, user.id, active.agencyId),
      Promise.resolve(d),
    ]);
  });
  const names = await withUser(db, user, (tx) =>
    memberEmails(tx, active.agencyId, [...rows.map((r) => r.assigneeId), detail?.conversation.assigneeId ?? null, ...(detail?.messages.map((m) => m.authorId) ?? []), ...(detail?.events.map((e) => e.actorId) ?? [])]),
  );
  const who = (id: string | null) => (id ? displayName(names.get(id) ?? "Persona retirada") : "Sin asignar");
  const isAdmin = can(active.role, "inbox.manage");
  const href = (over: { f?: string; c?: string | null }) => {
    const p = new URLSearchParams();
    p.set("f", over.f ?? filter);
    if (q) p.set("q", q);
    const c = over.c === undefined ? selectedId : over.c;
    if (c) p.set("c", c);
    return `/app/bandeja?${p.toString()}`;
  };
  const tabCount: Partial<Record<InboxFilter, number>> = { sin_responder: counts0.unansweredTeam, mias: counts0.mine, sin_asignar: counts0.unassigned };
  const others = counts0.byAssignee.filter((b) => b.assigneeId && b.assigneeId !== user.id);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        icon="inbox"
        eyebrow="Formulario web, chat y correo en un solo lugar"
        title="Bandeja"
        actions={
          <>
            <Link href="/app/bandeja/respuestas" className={secondaryButtonClass}>
              <Icon name="zap" className="size-4" /> Respuestas guardadas
            </Link>
            {isAdmin && (
              <Link href="/app/configuracion/canales" className={linkButtonClass}>
                Canales de entrada
              </Link>
            )}
          </>
        }
      />
      <Flash sp={sp} />
      {isAdmin && counts0.unansweredTeam > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">
          <Icon name="alert" className="size-5" />
          <span className="min-w-0 flex-1">
            <b>{counts0.unansweredTeam === 1 ? "1 conversación del equipo sin responder" : `${counts0.unansweredTeam} conversaciones del equipo sin responder`}</b> (pasaron el tiempo máximo en horario laboral)
            {counts0.byAssignee.length > 0 && ": "}
            {counts0.byAssignee.map((b) => `${b.n} ${b.assigneeId ? `de ${who(b.assigneeId)}` : "sin asignar"}`).join(", ")}.
          </span>
          {filter !== "sin_responder" && (
            <Link href={href({ f: "sin_responder", c: null })} className="rounded border border-red-300 bg-surface px-3 py-1.5 font-medium text-red-800 hover:bg-red-100">
              Ver sin responder
            </Link>
          )}
        </div>
      )}
      {!isAdmin && others.length === 0 && counts0.unansweredMine > 0 && filter !== "sin_responder" && (
        <Notice tone="error">
          Tienes {counts0.unansweredMine === 1 ? "1 conversación" : `${counts0.unansweredMine} conversaciones`} sin responder. <Link href={href({ f: "sin_responder", c: null })} className="font-medium underline">Respóndelas primero</Link>.
        </Notice>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_300px]">
        {/* Lista */}
        <Card title="Conversaciones" icon="inbox" bodyClassName="" className={detail ? "hidden lg:block" : ""}>
          <nav aria-label="Filtros de la bandeja" className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
            {INBOX_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href({ f: f.key, c: null })}
                aria-current={f.key === filter ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm ${f.key === filter ? "bg-brand-soft font-semibold text-brand-text" : "text-slate-700 hover:bg-slate-50"}`}
              >
                {f.label}
                {tabCount[f.key] ? (
                  <span className={`rounded-full px-1.5 text-[11px] leading-[18px] font-bold ${f.key === "sin_responder" ? "bg-red-600 text-white" : "bg-slate-200 text-slate-800"}`}>{tabCount[f.key]}</span>
                ) : null}
              </Link>
            ))}
          </nav>
          <form role="search" action="/app/bandeja" className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <input type="hidden" name="f" value={filter} />
            <label htmlFor="buscar-bandeja" className="sr-only">Buscar en la bandeja</label>
            <input id="buscar-bandeja" name="q" type="search" defaultValue={q} maxLength={100} placeholder="Nombre, teléfono o correo" className={`${inputClass} w-full py-1.5`} />
            <button className="rounded border border-slate-300 px-2.5 py-1.5 text-sm text-brand-text hover:bg-slate-50" aria-label="Buscar">
              <Icon name="search" className="size-4" />
            </button>
          </form>
          {rows.length === 0 ? (
            <div className="p-3">
              <Notice>{q ? `No hay conversaciones que coincidan con “${q}” en este filtro.` : EMPTY[filter]}</Notice>
            </div>
          ) : (
            <ul>
              {rows.map((r) => {
                const late = isUnanswered(r, now);
                const step = conversationStep(r);
                const sel = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <Link
                      href={href({ c: r.id })}
                      aria-current={sel ? "true" : undefined}
                      className={`flex gap-2.5 border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50 ${sel ? "bg-brand-softer shadow-[inset_3px_0_0_var(--brand)]" : ""}`}
                    >
                      <ChannelBadge kind={r.channel} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{r.contactName}</span>
                          <span className={`text-xs whitespace-nowrap ${late ? "font-semibold text-red-700" : "text-slate-600"}`}>{waitLabel(r.lastInboundAt ?? r.updatedAt, now)}</span>
                        </span>
                        <span className="truncate text-xs text-slate-600">{r.preview ?? r.subject ?? ""}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusChip status={r.status} late={late} />
                          <span className="text-xs text-slate-600">{who(r.assigneeId)}</span>
                          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-text">
                            <Icon name={STEP_ICON[step]} className="size-3.5" />
                            {STEP_LABELS[step]}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Conversación */}
        {detail ? (
          <Conversation detail={detail} role={active.role} me={user.id} filter={filter} who={who} members={members} replies={replies.map((r) => ({ id: r.id, title: r.title, shortcut: r.shortcut, body: r.body, personal: !!r.ownerId }))} agencyName={active.agencyName} myName={displayName(user.email)} now={now} backHref={href({ c: null })} />
        ) : (
          <Card className="hidden lg:block xl:col-span-2" bodyClassName="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-slate-600">
            <Icon name="inbox" className="size-10 text-slate-400" />
            <p className="font-semibold text-slate-800">Elige una conversación de la lista</p>
            <p>Empieza por las que están en rojo: llevan más tiempo esperando.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function ChannelBadge({ kind }: { kind: InboundKind }) {
  return (
    <span title={CHANNEL_LABELS[kind]} className={`flex size-8 shrink-0 items-center justify-center rounded-full ${CHANNEL_TONE[kind]}`}>
      <Icon name={CHANNEL_ICON[kind]} className="size-4" />
      <span className="sr-only">{CHANNEL_LABELS[kind]}</span>
    </span>
  );
}

function StatusChip({ status, late }: { status: "abierta" | "pendiente" | "resuelta"; late: boolean }) {
  if (late) return <Chip tone="red" icon="alert">Sin responder</Chip>;
  const tone: Record<typeof status, ChipTone> = { abierta: "amber", pendiente: "gray", resuelta: "green" };
  return <Chip tone={tone[status]}>{STATUS_LABELS[status]}</Chip>;
}

type Detail = NonNullable<Awaited<ReturnType<typeof getConversation>>>;

function Conversation({
  detail,
  role,
  me,
  filter,
  who,
  members,
  replies,
  agencyName,
  myName,
  now,
  backHref,
}: {
  detail: Detail;
  role: "admin" | "asesor" | "lectura";
  me: string;
  filter: InboxFilter;
  who: (id: string | null) => string;
  members: { userId: string; email: string; role: string }[];
  replies: { id: string; title: string; shortcut: string; body: string; personal: boolean }[];
  agencyName: string;
  myName: string;
  now: Date;
  backHref: string;
}) {
  const c = detail.conversation;
  const acts = conversationActions(role, me, c);
  const late = isUnanswered(c, now);
  const guide = conversationGuide({ ...c, openTasks: detail.openTasks }, me);
  // Mensajes y eventos (tomó, resolvió…) en un solo hilo por hora.
  const thread = [
    ...detail.messages.map((m) => ({ type: "m" as const, at: m.createdAt, m })),
    ...detail.events.filter((e) => e.kind !== "bandeja.respuesta" && e.kind !== "bandeja.recibido").map((e) => ({ type: "e" as const, at: e.createdAt, e })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const channels = [
    { via: "whatsapp" as const, label: "Enviar por WhatsApp", blocked: !detail.phone ? "El contacto no dejó teléfono." : !detail.whatsappAllowed ? "El contacto retiró el permiso de WhatsApp." : null },
    { via: "correo" as const, label: "Enviar por correo", blocked: !detail.email ? "El contacto no dejó correo." : !detail.emailAllowed ? "El contacto retiró el permiso de correo." : null },
  ];
  const hidden = (
    <>
      <input type="hidden" name="conversationId" value={c.id} />
      <input type="hidden" name="f" value={filter} />
    </>
  );

  return (
    <>
      <section aria-label={`Conversación con ${detail.contactName}`} className="flex min-w-0 flex-col rounded border border-line bg-surface shadow-[0_2px_2px_rgba(0,0,0,0.05)]">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-brand-text lg:hidden">
            <Icon name="left" className="size-4" /> Lista
          </Link>
          <ChannelBadge kind={c.channel} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-slate-900">{detail.contactName}</h2>
            <p className="truncate text-xs text-slate-600">
              {CHANNEL_LABELS[c.channel]}
              {detail.phone ? ` · ${formatPhone(detail.phone)}` : ""}
              {detail.email ? ` · ${detail.email}` : ""}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2">
            {late ? <Chip tone="red" icon="alert">Sin responder · {waitLabel(c.lastInboundAt ?? c.createdAt, now)}</Chip> : <StatusChip status={c.status} late={false} />}
            <span className="text-xs text-slate-600">Responsable: <b className="text-slate-800">{who(c.assigneeId)}</b></span>
            {acts.take && (
              <form action={takeConversationAction}>
                {hidden}
                <button className="inline-flex items-center gap-1.5 rounded bg-brand px-3 py-1.5 text-sm font-medium text-brand-contrast hover:bg-brand-strong">
                  <Icon name="hand" className="size-4" /> Tomar
                </button>
              </form>
            )}
            {acts.resolve && (
              // Pide confirmación: la conversación sale de las listas de trabajo (prueba independiente, H-6).
              <details className="relative">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-brand-text hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                  <Icon name="check" className="size-4" /> Resolver
                </summary>
                <form action={resolveConversationAction} className="absolute right-0 z-10 mt-1 w-64 rounded border border-line bg-surface p-3 text-sm shadow-lg">
                  {hidden}
                  <p className="text-slate-700">Sale de Mías y de Sin asignar. Si el cliente vuelve a escribir, se reabre sola.</p>
                  <button className="mt-2 rounded bg-brand px-3 py-1.5 font-medium text-brand-contrast hover:bg-brand-strong">Sí, resolver</button>
                </form>
              </details>
            )}
          </div>
        </header>
        {acts.reassign && (
          <form action={assignConversationAction} className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm">
            {hidden}
            <label htmlFor={`asignar-${c.id}`} className="text-slate-700">Asignar a</label>
            <select id={`asignar-${c.id}`} name="assigneeId" defaultValue={c.assigneeId ?? ""} className="rounded border border-slate-300 bg-surface px-2 py-1 text-slate-900">
              <option value="">Sin asignar (cola)</option>
              {members.filter((m) => m.role !== "lectura").map((m) => (
                <option key={m.userId} value={m.userId}>{m.email}</option>
              ))}
            </select>
            <button className="rounded border border-slate-300 bg-surface px-3 py-1 font-medium text-brand-text hover:bg-slate-100">Cambiar</button>
          </form>
        )}
        <ol className="flex flex-col gap-3 bg-canvas px-4 py-4" aria-label="Mensajes">
          {thread.map((item) =>
            item.type === "m" ? (
              <li key={item.m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${item.m.direction === "entrante" ? "self-start border border-slate-200 bg-surface" : "self-end bg-brand-soft"}`}>
                <p className="whitespace-pre-wrap text-slate-900">{item.m.body}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {item.m.direction === "entrante" ? detail.contactName.split(" ")[0] : who(item.m.authorId)} · {fechaHora.format(item.m.createdAt)} · {VIA_LABELS[item.m.via]}
                  {item.m.direction === "saliente" && item.m.via !== "chat" ? " (enviado desde su app)" : ""}
                </p>
              </li>
            ) : (
              <li key={item.e.id} className="self-center rounded-full bg-slate-100 px-3 py-0.5 text-xs text-slate-700">
                {who(item.e.actorId)}: {describeActivity(item.e.kind, item.e.data, members).toLowerCase()} · {fechaHora.format(item.e.createdAt)}
              </li>
            ),
          )}
        </ol>
        {acts.reply ? (
          <Composer
            key={c.id}
            conversationId={c.id}
            filter={filter}
            replies={replies}
            values={{ nombre: detail.contactName, asesor: myName, agencia: agencyName }}
            channels={channels}
            hint={
              c.status === "resuelta"
                ? "Esta conversación está resuelta. Si respondes, vuelve a Pendiente, esperando al cliente."
                : "El formulario se responde por WhatsApp o correo: se abre tu app con el texto y aquí queda registrado."
            }
          />
        ) : (
          <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">Tu rol es de solo lectura: puedes ver la conversación, pero no responder.</p>
        )}
      </section>

      <div className="flex flex-col gap-3 lg:col-start-2 xl:col-start-auto">
        <Card title="Qué hacer ahora" icon="star">
          <ol className="flex flex-col">
            {guide.map((s, i) => (
              <li key={s.key} className="flex flex-col items-stretch">
                <div aria-current={s.state === "actual" ? "step" : undefined} className={`flex gap-2.5 rounded border px-3 py-2 ${s.state === "actual" ? "border-brand bg-brand-softer" : "border-slate-200"}`}>
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.state === "hecho" ? "bg-emerald-600 text-white" : s.state === "actual" ? "bg-brand text-brand-contrast" : "bg-slate-200 text-slate-700"}`}>
                    {s.state === "hecho" ? <Icon name="done" className="size-3.5" /> : i + 1}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-slate-900">{s.title}</p>
                    <p className="text-xs text-slate-600">{s.detail}</p>
                    {s.key === "siguiente" && s.state !== "hecho" && detail.opportunity && (
                      <Link href={`/app/oportunidades/${detail.opportunity.id}#nueva-tarea`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-text hover:underline">
                        Definir paso <Icon name="arrow" className="size-3.5" />
                      </Link>
                    )}
                    {s.key === "oportunidad" && s.state !== "hecho" && (
                      <Link href={`/app/oportunidades/nueva?contactId=${c.contactId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-text hover:underline">
                        <Icon name="plus" className="size-3.5" /> Crear oportunidad
                      </Link>
                    )}
                  </div>
                </div>
                {i < guide.length - 1 && (
                  <span aria-hidden className="flex justify-center py-0.5 text-slate-400">
                    <Icon name="down" className="size-4" />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Contacto" icon="users">
          <div className="flex flex-col gap-1.5 text-sm">
            <Link href={`/app/contactos/${c.contactId}`} className="font-semibold text-brand-text hover:underline">{detail.contactName}</Link>
            {detail.opportunity ? (
              <p className="text-slate-700">
                Oportunidad:{" "}
                <Link href={`/app/oportunidades/${detail.opportunity.id}`} className="text-brand-text hover:underline">
                  {detail.opportunity.destination || "Destino sin definir"}
                </Link>{" "}
                · {detail.opportunity.stageName}
              </p>
            ) : (
              <p className="text-slate-600">Sin oportunidad vinculada.</p>
            )}
            {detail.otherConversations.length > 0 && (
              <div className="text-slate-700">
                Otras conversaciones:
                <ul className="mt-1 flex flex-col gap-0.5">
                  {detail.otherConversations.map((o) => (
                    <li key={o.id}>
                      <Link href={`/app/bandeja?c=${o.id}`} className="text-xs text-brand-text hover:underline">
                        {CHANNEL_LABELS[o.channel]} · {fechaHora.format(o.createdAt)} · {STATUS_LABELS[o.status]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
