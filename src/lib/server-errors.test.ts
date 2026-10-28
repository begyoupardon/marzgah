import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { ORPCError, ValidationError } from '@orpc/server'
import { BackendError } from '#/lib/backends/types'
import { MarzbanApiError } from '#/lib/marzban/client'
import {
  isAlreadyLogged,
  logProcedureEvent,
  logServerError,
  markAsLogged,
  toAppORPCError,
} from './server-errors'

describe('server-errors', () => {
  const originalEnv = process.env.NODE_ENV
  const originalDebug = process.env.DEBUG
  const logs: { info: string[]; warn: string[]; error: unknown[] } = {
    info: [],
    warn: [],
    error: [],
  }

  const origInfo = console.info
  const origWarn = console.warn
  const origError = console.error

  beforeEach(() => {
    logs.info = []
    logs.warn = []
    logs.error = []
    console.info = (msg: string) => logs.info.push(msg)
    console.warn = (msg: string) => logs.warn.push(msg)
    console.error = (...args: unknown[]) => logs.error.push(args)
    process.env.NODE_ENV = 'development'
    delete process.env.DEBUG
  })

  afterEach(() => {
    console.info = origInfo
    console.warn = origWarn
    console.error = origError
    process.env.NODE_ENV = originalEnv
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug
    } else {
      delete process.env.DEBUG
    }
  })

  describe('markAsLogged and isAlreadyLogged', () => {
    it('marks and detects logged errors', () => {
      const err = new Error('test')
      expect(isAlreadyLogged(err)).toBe(false)
      markAsLogged(err)
      expect(isAlreadyLogged(err)).toBe(true)
    })

    it('gracefully handles primitives and nulls', () => {
      expect(isAlreadyLogged(null)).toBe(false)
      expect(isAlreadyLogged(undefined)).toBe(false)
      expect(isAlreadyLogged('string')).toBe(false)
      markAsLogged(null)
      markAsLogged('string')
    })
  })

  describe('toAppORPCError', () => {
    it('returns existing ORPCError as-is', () => {
      const err = new ORPCError('FORBIDDEN', { message: 'Forbidden access' })
      expect(toAppORPCError(err)).toBe(err)
    })

    it('formats ValidationError issues into message', () => {
      const valErr = new ValidationError({
        message: 'Invalid input',
        issues: [
          { path: ['user', 'email'], message: 'Invalid email address' },
          { path: ['amount'], message: 'Must be positive' },
        ],
      })
      const orpcErr = toAppORPCError(valErr)
      expect(orpcErr.code).toBe('BAD_REQUEST')
      expect(orpcErr.status).toBe(400)
      expect(orpcErr.message).toContain('user.email: Invalid email address')
      expect(orpcErr.message).toContain('amount: Must be positive')
      expect(orpcErr.cause).toBe(valErr)
    })

    it('maps BackendError codes and preserves cause', () => {
      const notFound = new BackendError('User missing', 'NOT_FOUND', 404)
      const orpcNotFound = toAppORPCError(notFound)
      expect(orpcNotFound.code).toBe('NOT_FOUND')
      expect(orpcNotFound.status).toBe(404)
      expect(orpcNotFound.cause).toBe(notFound)

      const conflict = new BackendError('User exists', 'CONFLICT', 409)
      const orpcConflict = toAppORPCError(conflict)
      expect(orpcConflict.code).toBe('CONFLICT')
      expect(orpcConflict.status).toBe(409)
      expect(orpcConflict.cause).toBe(conflict)

      const unsupported = new BackendError('No pass', 'UNSUPPORTED', 400)
      const orpcUnsupported = toAppORPCError(unsupported)
      expect(orpcUnsupported.code).toBe('BAD_REQUEST')
      expect(orpcUnsupported.status).toBe(400)
      expect(orpcUnsupported.cause).toBe(unsupported)

      const unavailable = new BackendError('Down', 'UNAVAILABLE', 503)
      const orpcUnavailable = toAppORPCError(unavailable)
      expect(orpcUnavailable.code).toBe('INTERNAL_SERVER_ERROR')
      expect(orpcUnavailable.status).toBe(500)
      expect(orpcUnavailable.cause).toBe(unavailable)
    })

    it('maps MarzbanApiError codes and preserves cause', () => {
      const err404 = new MarzbanApiError('Not found', 404)
      expect(toAppORPCError(err404).code).toBe('NOT_FOUND')
      expect(toAppORPCError(err404).cause).toBe(err404)

      const err409 = new MarzbanApiError('Duplicate', 409)
      expect(toAppORPCError(err409).code).toBe('CONFLICT')

      const err422 = new MarzbanApiError('Unprocessable', 422)
      expect(toAppORPCError(err422).code).toBe('BAD_REQUEST')

      const err500 = new MarzbanApiError('Server error', 500)
      expect(toAppORPCError(err500).code).toBe('INTERNAL_SERVER_ERROR')
      expect(toAppORPCError(err500).cause).toBe(err500)
    })

    it('wraps unknown Error as INTERNAL_SERVER_ERROR with cause', () => {
      const raw = new Error('Disk failure')
      const orpc = toAppORPCError(raw)
      expect(orpc.code).toBe('INTERNAL_SERVER_ERROR')
      expect(orpc.status).toBe(500)
      expect(orpc.cause).toBe(raw)
    })
  })

  describe('logProcedureEvent', () => {
    it('logs 200 OK at info level with duration, user and ip', () => {
      logProcedureEvent({
        procedure: 'vpnUsers.list',
        status: 200,
        durationMs: 14,
        user: 'admin@test.com (admin)',
        ip: '10.0.0.1',
      })
      expect(logs.info).toHaveLength(1)
      expect(logs.info[0]).toBe(
        '[orpc] 200 OK vpnUsers.list [14ms] [user: admin@test.com (admin)] [ip: 10.0.0.1]',
      )
    })

    it('logs 4xx operational errors at warn level', () => {
      logProcedureEvent({
        procedure: 'auth.login',
        status: 401,
        code: 'UNAUTHORIZED',
        durationMs: 5,
        user: null,
        ip: '127.0.0.1',
        message: 'نشست منقضی شده است',
      })
      expect(logs.warn).toHaveLength(1)
      expect(logs.warn[0]).toBe(
        '[orpc] 401 UNAUTHORIZED auth.login [5ms] [anon] [ip: 127.0.0.1]: نشست منقضی شده است',
      )
    })

    it('logs 5xx server errors at error level along with error cause', () => {
      const cause = new Error('Database connection failed')
      logProcedureEvent({
        procedure: 'vpnUsers.create',
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        durationMs: 120,
        user: 'admin@test.com (admin)',
        ip: '10.0.0.2',
        message: 'ارتباط با سرور VPN برقرار نشد',
        error: cause,
      })
      expect(logs.error).toHaveLength(2)
      expect(logs.error[0]).toEqual([
        '[orpc] 500 INTERNAL_SERVER_ERROR vpnUsers.create [120ms] [user: admin@test.com (admin)] [ip: 10.0.0.2]: ارتباط با سرور VPN برقرار نشد',
      ])
      expect(logs.error[1]).toEqual([cause])
    })

    it('suppresses logs in test mode unless DEBUG is set', () => {
      process.env.NODE_ENV = 'test'
      delete process.env.DEBUG
      logProcedureEvent({
        procedure: 'test',
        status: 200,
        durationMs: 1,
      })
      expect(logs.info).toHaveLength(0)
    })
  })

  describe('logServerError', () => {
    it('skips already logged errors', () => {
      const err = new ORPCError('NOT_FOUND', { message: 'Missing' })
      markAsLogged(err)
      logServerError(err, 'rpc')
      expect(logs.warn).toHaveLength(0)
      expect(logs.error).toHaveLength(0)
    })

    it('logs protocol-level client error at warn level with http metadata', () => {
      const err = new ORPCError('NOT_FOUND', { message: 'Route not found' })
      logServerError(err, 'rpc', {
        method: 'POST',
        path: '/api/rpc/missing',
        ip: '127.0.0.1',
      })
      expect(logs.warn).toHaveLength(1)
      expect(logs.warn[0]).toBe(
        '[rpc] 404 NOT_FOUND POST /api/rpc/missing [ip: 127.0.0.1]: Route not found',
      )
    })

    it('logs protocol-level server error at error level', () => {
      const err = new Error('Malformed body')
      logServerError(err, 'rpc', {
        method: 'POST',
        path: '/api/rpc/bad',
        ip: '10.0.0.5',
      })
      expect(logs.error).toHaveLength(2)
      expect(logs.error[0]).toEqual([
        '[rpc] 500 INTERNAL_SERVER_ERROR POST /api/rpc/bad [ip: 10.0.0.5]: Malformed body',
      ])
      expect(logs.error[1]).toEqual([err])
    })
  })
})
