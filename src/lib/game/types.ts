/**
 * Domain types for f(kill). This file is the single source of truth for the
 * shapes that cross the maths engine, game engine, CPU, UI and multiplayer
 * authority. Nothing here may import Svelte or browser APIs: the engine runs
 * unchanged in the browser, in tests and on the relay server.
 */

export interface Vector2 {
	x: number;
	y: number;
}

export type GrapherType = 'basic' | 'buzzer' | 'sniper' | 'spray' | 'arc';

export type AttackMode = 'function' | 'multi-function' | 'arc';

/** Central, data-driven definition of a grapher's weapon capabilities. */
export interface GrapherTypeDefinition {
	id: GrapherType;
	label: string;
	description: string;
	attackMode: AttackMode;
	/** Maximum distinct real roots for a single function. */
	maxRoots: number;
	/** Spray only: total root budget shared across every submitted function. */
	maxTotalRoots?: number;
	/** Spray only: how many functions may be submitted at once. */
	maxFunctions?: number;
	/** Total width of the valid local coordinate window (centred on 0,0). */
	domainRangeSpan: number;
	/** Arc only: maximum radius in coordinate units. */
	maxArcRadius?: number;
	/** Arc only: maximum absolute angular sweep in degrees. */
	maxArcSweepDegrees?: number;
	damageToGraphers: number;
	damageToObstacles: number;
	/** Editor hint shown next to the equation input. */
	inputHint: string;
}

export type SchedulingMode = 'round-robin' | 'random' | 'ffa';
export type SelectionMode = 'manual' | 'auto-round-robin' | 'auto-random';
export type CoordinateMode = 'shared' | 'local';
export type PlacementMode = 'manual' | 'auto';
export type AutoPlacementDistribution = 'uniform' | 'even' | 'clustered' | 'min-separation';
export type ObstacleArrangement = 'none' | 'scattered' | 'corridor' | 'fortress' | 'random';
export type PlayerKind = 'human' | 'cpu';

export type CpuDifficulty =
	| 'easy'
	| 'casual'
	| 'steady'
	| 'sharp'
	| 'expert'
	| 'master'
	| 'grandmaster'
	| 'asian';

export interface ObstacleRules {
	enabled: boolean;
	arrangement: ObstacleArrangement;
	/** Number of obstacles for `scattered` / `random` arrangements. */
	count: number;
	/** Minimum obstacle size (radius-like measure) in coordinate units. */
	minSize: number;
	maxSize: number;
	/** Damage points one section absorbs before it is destroyed. */
	durability: number;
	indestructible: boolean;
	/** When true an attack keeps travelling after destroying a section. */
	punchThrough: boolean;
	/** Section grid resolution in coordinate units. */
	sectionSize: number;
}

export interface CoordinateRules {
	mode: CoordinateMode;
	/** Only meaningful when mode === 'local'. */
	allowRotation: boolean;
	showAxes: boolean;
	showGrid: boolean;
	/** Finest visible grid spacing in coordinate units (rendering only). */
	gridSpacing: number;
	labels: boolean;
}

export interface PrecisionRules {
	/** Legal placement positions are multiples of 1/denominator. */
	denominator: number;
	/** When false, exact coordinates are never revealed to clients. */
	showCoordinates: boolean;
}

export interface TurnRules {
	mode: SchedulingMode;
	/** Players acting concurrently within one round-robin / random batch. */
	concurrentPlayers: number;
	/** Seconds per turn batch. Ignored (and disabled) in FFA. */
	timePerTurnSeconds: number;
}

export interface ScoringRules {
	baseHitPoints: number;
	precisionBonusMax: number;
	/** Decimal places used when rounding the final score per hit. */
	roundingDigits: number;
}

export interface PlacementRules {
	mode: PlacementMode;
	distribution: AutoPlacementDistribution;
	/** Minimum centre-to-centre separation for generated positions. */
	minSeparation: number;
}

export interface SafetyLimits {
	maxExpressionLength: number;
	maxAstNodes: number;
	maxAstDepth: number;
	maxSamples: number;
	maxRootGrid: number;
	maxRootsToCount: number;
	/** FFA anti-flood: minimum ms between accepted attacks per player. */
	minSubmitIntervalMs: number;
	/** FFA anti-flood: accepted attacks per rolling window. */
	maxSubmitsPerWindow: number;
	submitWindowMs: number;
}

export interface GameRules {
	/** Absolute cap across humans + CPUs; the game is defined for 10. */
	maxPlayers: number;
	/** 1..20 */
	maxGraphersPerPlayer: number;
	/** 1..20 */
	grapherHealth: number;
	/** Target hit-zone radius in coordinate units. */
	targetHitRadius: number;
	/** World plane is worldSize x worldSize, centred on the origin. */
	worldSize: number;
	grapherTypes: Record<GrapherType, GrapherTypeDefinition>;
	/** Central base cooldown, multiplied by cooldownMultiplier. */
	baseCooldownSeconds: number;
	/** 0..5. 0 disables cooldowns. Ignored when selection is automatic. */
	cooldownMultiplier: number;
	selection: SelectionMode;
	turns: TurnRules;
	coordinates: CoordinateRules;
	precision: PrecisionRules;
	obstacles: ObstacleRules;
	scoring: ScoringRules;
	placement: PlacementRules;
	limits: SafetyLimits;
}

export interface PlayerConfig {
	id: string;
	name: string;
	kind: PlayerKind;
	/** Index into the player colour/marker palette (0..9). */
	colorIndex: number;
	cpuDifficulty?: CpuDifficulty;
	/** Grapher types chosen for this player, in order. Capped by rules. */
	loadout: GrapherType[];
}

export interface ManualPlacement {
	playerId: string;
	/** One position per grapher in the player's loadout. */
	positions: Vector2[];
}

export interface MatchSetup {
	seed: string;
	players: PlayerConfig[];
	manualPlacements?: Record<string, Vector2[]>;
	/** Optional explicit rotations for local-plane mode (radians per grapher). */
	rotations?: Record<string, number[]>;
}

export interface MatchConfig {
	rules: GameRules;
	setup: MatchSetup;
}

export interface Player {
	id: string;
	name: string;
	kind: PlayerKind;
	colorIndex: number;
	cpuDifficulty?: CpuDifficulty;
	score: number;
	hits: number;
	shots: number;
	damageDealt: number;
	graphersDestroyed: number;
	obstacleSectionsDestroyed: number;
	alive: boolean;
	connected: boolean;
}

export interface Grapher {
	id: string;
	ownerId: string;
	type: GrapherType;
	position: Vector2;
	/** Local-plane rotation in radians (counter-clockwise). */
	rotation: number;
	health: number;
	maxHealth: number;
	alive: boolean;
	cooldownUntil: number | null;
}

export interface ObstacleShapeCircle {
	kind: 'circle';
	center: Vector2;
	radius: number;
}

export interface ObstacleShapePolygon {
	kind: 'polygon';
	points: Vector2[];
}

export interface ObstacleShapeRoundRect {
	kind: 'roundRect';
	x: number;
	y: number;
	width: number;
	height: number;
	cornerRadius: number;
}

export type ObstacleShape = ObstacleShapeCircle | ObstacleShapePolygon | ObstacleShapeRoundRect;

export interface ObstacleSection {
	id: string;
	/** Centre of the section cell. */
	center: Vector2;
	size: number;
	maxDurability: number;
	durability: number;
	destroyed: boolean;
}

export interface Obstacle {
	id: string;
	shape: ObstacleShape;
	indestructible: boolean;
	sections: ObstacleSection[];
}

export interface FunctionComponentInput {
	kind: 'function';
	expression: string;
}

export interface ArcComponentInput {
	kind: 'arc';
	/** Arc centre in the firing grapher's local coordinates. */
	center: Vector2;
	radius: number;
	/** Degrees, 0 = local +x axis, counter-clockwise positive. */
	startAngleDeg: number;
	/** Degrees, positive = counter-clockwise, max configured sweep. */
	sweepAngleDeg: number;
}

export type AttackComponentInput = FunctionComponentInput | ArcComponentInput;

export interface SubmitAttackAction {
	type: 'submit-attack';
	playerId: string;
	grapherId?: string;
	components: AttackComponentInput[];
}

export interface PassTurnAction {
	type: 'pass';
	playerId: string;
}

export interface TickAction {
	type: 'tick';
	now: number;
}

/** Internal action used by the authority to keep timers advancing. */
export type GameAction = SubmitAttackAction | PassTurnAction | TickAction;

export interface TurnState {
	mode: SchedulingMode;
	activePlayerIds: string[];
	batchNumber: number;
	batchStartedAt: number;
	/** null in FFA (no turn timer). */
	endsAt: number | null;
	/** Players in the active batch who already acted. */
	actedPlayerIds: string[];
	/** Remaining random schedule bag (without replacement within a cycle). */
	bag: string[];
	/** Random scheduling cursor used for reproducible tie-free draws. */
	randomState: number;
}

export interface TargetHit {
	targetId: string;
	targetOwnerId: string;
	componentIndex: number;
	distance: number;
	hitRadius: number;
	damage: number;
	score: number;
	precisionRatio: number;
	destroyed: boolean;
}

export interface ObstacleHit {
	obstacleId: string;
	sectionId: string;
	componentIndex: number;
	damage: number;
	destroyed: boolean;
}

export interface ComponentOutcome {
	componentIndex: number;
	kind: 'function' | 'arc';
	expression?: string;
	arc?: ArcComponentInput;
	/** World-space geometry is regenerated on demand; never sent on the wire. */
	outcome: 'hit' | 'miss' | 'blocked' | 'invalid';
	targetsHit: TargetHit[];
	obstaclesHit: ObstacleHit[];
	damage: number;
	score: number;
	/** True when a target was geometrically hit but its path was occluded. */
	blockedBy?: string;
	error?: string;
}

export interface AttackRecord {
	id: string;
	playerId: string;
	grapherId: string;
	grapherType: GrapherType;
	batchNumber: number;
	submittedAt: number;
	components: ComponentOutcome[];
	totalDamage: number;
	totalScore: number;
	targetsHit: number;
	destroyedTargetIds: string[];
}

export type GameEventType =
	| 'match-created'
	| 'match-started'
	| 'match-finished'
	| 'turn-started'
	| 'turn-ended'
	| 'attack-accepted'
	| 'attack-rejected'
	| 'grapher-destroyed'
	| 'obstacle-destroyed'
	| 'player-eliminated'
	| 'player-disconnected'
	| 'player-reconnected'
	| 'player-left'
	| 'cpu-action';

export interface GameEvent {
	id: number;
	at: number;
	type: GameEventType;
	message: string;
	playerId?: string;
	attackId?: string;
	data?: Record<string, string | number | boolean>;
}

export interface MatchStats {
	startedAt: number;
	finishedAt: number | null;
	batchCount: number;
	attacks: number;
}

export interface MatchState {
	id: string;
	seed: string;
	phase: 'running' | 'finished';
	rules: GameRules;
	players: Player[];
	graphers: Grapher[];
	obstacles: Obstacle[];
	turn: TurnState;
	attacks: AttackRecord[];
	events: GameEvent[];
	stats: MatchStats;
	winnerIds: string[];
	/** Deterministic integration step used by `tick` to detect finished games. */
	now: number;
	nextEventId: number;
	nextAttackId: number;
	/** Per-player cursor for automatic round-robin grapher selection. */
	autoSelectionCursor: Record<string, number>;
	/** Recent accepted submission timestamps per player (FFA flood control). */
	recentSubmits: Record<string, number[]>;
}

/* ---------------------------------------------------------------- results */

export interface ActionError {
	code:
		| 'not-your-turn'
		| 'turn-ended'
		| 'match-finished'
		| 'invalid-attack'
		| 'grapher-unavailable'
		| 'unknown-player'
		| 'unknown-grapher'
		| 'rate-limited'
		| 'wrong-phase'
		| 'not-owner'
		| 'bad-action';
	message: string;
	/** Optional per-component validation detail for the equation editor. */
	componentErrors?: { componentIndex: number; message: string }[];
}

export interface ActionResult {
	ok: boolean;
	state: MatchState;
	error?: ActionError;
	attack?: AttackRecord;
}

/* ------------------------------------------------------------- validation */

export interface ValidationIssue {
	code: string;
	message: string;
	/** 1-based character offset when available. */
	position?: number;
	componentIndex?: number;
}

export interface ValidationReport {
	ok: boolean;
	issues: ValidationIssue[];
}
