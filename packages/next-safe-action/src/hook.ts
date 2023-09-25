"use client";

import {
	experimental_useOptimistic,
	useCallback,
	useEffect,
	useRef,
	useState,
	useTransition,
} from "react";
import {} from "react/experimental";
import type { z } from "zod";
import type { HookActionStatus, HookCallbacks, HookResponse, SafeAction } from "./types";
import { isNextNotFoundError, isNextRedirectError } from "./utils";

// UTILS

const getActionStatus = <const Schema extends z.ZodTypeAny, const Data>(
	isExecuting: boolean,
	response: HookResponse<Schema, Data>
): HookActionStatus => {
	if (isExecuting) {
		return "executing";
	} else if (typeof response.data !== "undefined") {
		return "hasSucceded";
	} else if (
		typeof response.validationError !== "undefined" ||
		typeof response.serverError !== "undefined" ||
		typeof response.fetchError !== "undefined"
	) {
		return "hasErrored";
	}

	return "idle";
};

const useActionCallbacks = <const Schema extends z.ZodTypeAny, const Data>(
	response: HookResponse<Schema, Data>,
	input: z.input<Schema>,
	status: HookActionStatus,
	reset: () => void,
	cb?: HookCallbacks<Schema, Data>
) => {
	const onSuccessRef = useRef(cb?.onSuccess);
	const onErrorRef = useRef(cb?.onError);

	// Execute the callback on success or error, if provided.
	useEffect(() => {
		const onSuccess = onSuccessRef.current;
		const onError = onErrorRef.current;

		if (onSuccess && status === "hasSucceded") {
			onSuccess(response.data!, input, reset);
		} else if (onError && status === "hasErrored") {
			onError(response, input, reset);
		}
	}, [status, response, reset]);
};

/**
 * Use the action from a Client Component via hook.
 * @param safeAction The typesafe action.
 * @param cb Optional callbacks executed when the action succeeds or fails.
 *
 * {@link https://github.com/TheEdoRan/next-safe-action/tree/main/packages/next-safe-action#2-the-hook-way See an example}
 */
export const useAction = <const Schema extends z.ZodTypeAny, const Data>(
	safeAction: SafeAction<Schema, Data>,
	cb?: HookCallbacks<Schema, Data>
) => {
	const [isExecuting, startTransition] = useTransition();
	const executor = useRef(safeAction);
	const [response, setResponse] = useState<HookResponse<Schema, Data>>({});
	const [input, setInput] = useState<z.input<Schema>>();

	const status = getActionStatus<Schema, Data>(isExecuting, response);

	const execute = useCallback((input: z.input<Schema>) => {
		setInput(input);

		return startTransition(() => {
			return executor
				.current(input)
				.then((response) => setResponse(response))
				.catch((e) => {
					if (isNextRedirectError(e) || isNextNotFoundError(e)) {
						throw e;
					}

					setResponse({ fetchError: e });
				});
		});
	}, []);

	const reset = useCallback(() => {
		setResponse({});
	}, []);

	useActionCallbacks(response, input, status, reset, cb);

	return {
		execute,
		response,
		reset,
		status,
	};
};

/**
 * Use the action from a Client Component via hook, with optimistic data update.
 *
 * **NOTE: This hook uses an experimental React feature.**
 * @param safeAction The typesafe action.
 * @param initialOptData Initial optimistic data.
 * @param cb Optional callbacks executed when the action succeeds or fails.
 *
 * {@link https://github.com/TheEdoRan/next-safe-action/tree/main/packages/next-safe-action#optimistic-update--experimental See an example}
 */
export const useOptimisticAction = <const Schema extends z.ZodTypeAny, const Data>(
	safeAction: SafeAction<Schema, Data>,
	initialOptData: Data,
	cb?: HookCallbacks<Schema, Data>
) => {
	const [response, setResponse] = useState<HookResponse<Schema, Data>>({});
	const [input, setInput] = useState<z.input<Schema>>();

	const [optState, syncState] = experimental_useOptimistic<
		Data & { __isExecuting__: boolean },
		Partial<Data>
	>({ ...initialOptData, ...response.data, __isExecuting__: false }, (state, newState) => ({
		...state,
		...newState,
		__isExecuting__: true,
	}));

	const executor = useRef(safeAction);

	const status = getActionStatus<Schema, Data>(optState.__isExecuting__, response);

	const execute = useCallback(
		(input: z.input<Schema>, newOptimisticData: Partial<Data>) => {
			syncState(newOptimisticData);
			setInput(input);

			return executor
				.current(input)
				.then((response) => setResponse(response))
				.catch((e) => {
					// NOTE: this doesn't work at the moment.
					if (isNextRedirectError(e) || isNextNotFoundError(e)) {
						throw e;
					}

					setResponse({ fetchError: e });
				});
		},
		[syncState]
	);

	const reset = useCallback(() => {
		setResponse({});
	}, []);

	useActionCallbacks(response, input, status, reset, cb);

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { __isExecuting__: _, ...optimisticData } = optState;

	return {
		execute,
		response,
		optimisticData: optimisticData as Data, // removes omit of `__isExecuting__` from type
		reset,
		status,
	};
};

export type { HookActionStatus, HookCallbacks, HookResponse };
