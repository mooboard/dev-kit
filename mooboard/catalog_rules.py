"""Live package validation and deterministic ZIP writing, shared with the store builder."""
import hashlib
import json
import os
import re
import struct
import unicodedata
import zlib

CATALOG_USES = ('pong', 'snake', 'blocks', 'maze', 'aquarium', 'lava', 'aurora', 'rain', 'sunmoon', 'word', 'quotes', 'habits', 'timer', 'pomodoro', 'scoreboard', 'dice', 'breakout', 'invaders', 'flappy', 'cycles', 'fireworks', 'nightcity', 'snowglobe', 'raincode', 'oktowake', 'chores', 'facts', 'jokes', 'intervals', 'chessclock', 'wheel', 'tally', 'vfdstereo', 'microracer', 'pixelpinball', 'microrogue', 'spacelander')
USES = ('prayer', 'countdown', 'sketch', 'life', 'plasma', 'starfield', 'fireplace') + CATALOG_USES
SPEED = {'speed': ('choice', 3)}
SPEED_COLORS = dict(SPEED, colors=('choice', 2))
COLOR_SPEED = dict({'color': ('color', 0)}, **SPEED)

def _row(kind, settings=None, controls=None, needs=()):
    return {'kind': kind, 'needs': tuple(sorted(needs)), 'settings': dict(settings or {}), 'controls': dict(controls or {})}

def _buttons(*keys):
    return {key: ('button', 0) for key in keys}
RENDERER_KEYS = {'pong': _row('card', SPEED_COLORS, needs=('minute',)), 'snake': _row('card', SPEED_COLORS), 'blocks': _row('card', SPEED), 'maze': _row('card', SPEED), 'aquarium': _row('card', {'fish': ('choice', 3)}), 'lava': _row('card', COLOR_SPEED), 'aurora': _row('card', dict({'colors': ('choice', 3)}, **SPEED)), 'rain': _row('card', {'rain': ('choice', 3), 'city': ('choice', 2)}), 'sunmoon': _row('card', needs=('clock', 'place')), 'word': _row('card', needs=('clock', 'item')), 'quotes': _row('card', needs=('clock', 'item')), 'habits': _row('card', controls={'habits': ('list', 6)}, needs=('clock', 'entries')), 'timer': _row('hold', controls=dict(_buttons('start', 'add', 'pause', 'resume', 'cancel', 'sw_start', 'sw_stop', 'sw_reset'), countdown=('readout', 0), stopwatch=('readout', 0))), 'pomodoro': _row('hold', {'focus': ('choice', 6), 'break': ('choice', 3), 'long_break': ('choice', 4)}, dict(_buttons('start', 'pause', 'resume', 'skip', 'stop'), left=('readout', 0))), 'scoreboard': _row('hold', {'left': ('text', 8), 'right': ('text', 8), 'left_color': ('color', 0), 'right_color': ('color', 0)}, dict({'left': ('stepper', 0), 'right': ('stepper', 0)}, **_buttons('reset', 'done'))), 'dice': _row('hold', {'dice': ('choice', 2)}, dict(_buttons('roll', 'flip'), result=('readout', 0))), 'breakout': _row('card', SPEED), 'invaders': _row('card', SPEED_COLORS), 'flappy': _row('card', SPEED), 'cycles': _row('card', dict({'riders': ('choice', 3)}, **SPEED)), 'fireworks': _row('card', {'colors': ('choice', 3), 'show': ('choice', 2)}), 'nightcity': _row('card'), 'snowglobe': _row('card', {'scene': ('choice', 3)}), 'raincode': _row('card', COLOR_SPEED), 'oktowake': _row('night', {'bedtime': ('choice', 5), 'wake': ('choice', 5), 'clock': ('toggle', 0)}, needs=('clock',)), 'chores': _row('card', {'people': ('text', 32), 'rotate': ('choice', 2)}, {'chores': ('list', 6)}, needs=('clock', 'entries')), 'facts': _row('card', needs=('clock', 'item')), 'jokes': _row('card', needs=('clock', 'item')), 'intervals': _row('hold', {'work': ('choice', 5), 'rest': ('choice', 4), 'rounds': ('choice', 5)}, dict(_buttons('start', 'pause', 'resume', 'skip', 'stop'), phase=('readout', 0))), 'chessclock': _row('hold', {'time': ('choice', 6), 'increment': ('choice', 5)}, _buttons('left', 'right', 'pause', 'reset', 'done')), 'wheel': _row('hold', controls=dict({'items': ('list', 8)}, **_buttons('spin'))), 'tally': _row('hold', {'label': ('text', 12)}, dict({'count': ('stepper', 0)}, **_buttons('add', 'reset', 'done'))), 'vfdstereo': _row('card', {'mode': ('choice', 3), 'colors': ('choice', 3)}), 'microracer': _row('card', {'speed': ('choice', 3), 'track': ('choice', 3)}), 'pixelpinball': _row('card', {'speed': ('choice', 3), 'table': ('choice', 3)}), 'microrogue': _row('card', {'speed': ('choice', 3), 'theme': ('choice', 3)}), 'spacelander': _row('card', {'speed': ('choice', 3), 'planet': ('choice', 3)})}
CATALOG_FIRMWARE = (0, 3, 1)
BOARDS = ('s3', 'p4')
BOARD_CAP = {'s3': 2 * 1024 * 1024, 'p4': 8 * 1024 * 1024}
ENTRY_CAP = 512 * 1024
MAX_ENTRIES = 200
MAX_DEPTH = 3
MANIFEST_CAP = 8 * 1024
ICON_CAP = 8 * 1024
INDEX_CAP = 64 * 1024
ICON = 32
NAME_MAX = 24
DESCRIPTION_MAX = 80
KEYS = ('format', 'id', 'name', 'version', 'by', 'description', 'category', 'uses', 'minFirmware', 'boards', 'settings', 'controls')
SETTING_KEYS = ('key', 'type', 'label', 'default', 'max', 'options')
CONTROL_KEYS = ('key', 'type', 'label', 'arg', 'min', 'max', 'chars', 'add')
SETTINGS_MAX = 8
CONTROLS_MAX = 16
LABEL_MAX = 24
NEEDED_KEYS = ('format', 'id', 'name', 'version', 'by', 'description', 'category')
REPO_ONLY = ('README.md', 'LICENSE')
NOT_APPS = ('builder', 'dist', 'Seasonal')
ID = re.compile('[a-z0-9-]{1,32}')
KEY = re.compile('[a-z][a-z0-9_]{0,15}')
COLOR = re.compile('#[0-9A-Fa-f]{6}')
BY = re.compile('[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}')
NUMBER = '(?:0|[1-9][0-9]{0,8})'
SEMVER = re.compile('%s\\.%s\\.%s' % (NUMBER, NUMBER, NUMBER))
SEGMENT = '[A-Za-z0-9_-]+'
DATA_PATH = re.compile('%s(?:/%s){0,%d}\\.(?:json|bin)' % (SEGMENT, SEGMENT, MAX_DEPTH - 1))
STAMP = re.compile('[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z')
LOCAL, CENTRAL, END = (67324752, 33639248, 101010256)
ZIP_DATE = 33
UNIX = 3
MADE_BY = UNIX << 8 | 20
NEEDED = 10
REGULAR = 33188
PNG = b'\x89PNG\r\n\x1a\n'
PNG_KEEP = (b'IHDR', b'PLTE', b'tRNS', b'IDAT', b'IEND')

class Refused(Exception):
    pass

def _unique(pairs):
    keys = [key for key, _ in pairs]
    if len(set(keys)) != len(keys):
        raise ValueError(keys)
    return dict(pairs)

def _text(value, most):
    return isinstance(value, str) and 1 <= len(value) <= most and (value == value.strip()) and (not any((ord(ch) < 32 or ord(ch) == 127 for ch in value)))

def check_manifest(body, category, folder):
    where = '%s/%s/mooboard.json' % (category, folder)
    if len(body) > MANIFEST_CAP:
        raise Refused('%s is over 8 KB' % where)
    try:
        man = json.loads(body.decode('utf-8'), object_pairs_hook=_unique)
    except ValueError:
        raise Refused('%s is not valid JSON (or repeats a key)' % where)
    if not isinstance(man, dict):
        raise Refused('%s is not a JSON object' % where)
    for key in man:
        if key not in KEYS:
            raise Refused('%s: unknown key %s' % (where, key))
    for key in NEEDED_KEYS:
        if key not in man:
            raise Refused('%s needs %s' % (where, key))
    if type(man['format']) is not int or man['format'] != 2:
        raise Refused('%s: format must be 2' % where)
    if not isinstance(man['id'], str) or not ID.fullmatch(man['id']):
        raise Refused('%s: id must be 1 to 32 of a-z, 0-9 and -' % where)
    if not _text(man['name'], NAME_MAX) or '://' in man['name']:
        raise Refused('%s: name must be 1 to %d characters on one line' % (where, NAME_MAX))
    if man['name'] != folder:
        raise Refused("%s: name must be the folder's name, %s" % (where, folder))
    if not isinstance(man['version'], str) or not SEMVER.fullmatch(man['version']):
        raise Refused('%s: version must be X.Y.Z' % where)
    if not isinstance(man['by'], str) or not BY.fullmatch(man['by']):
        raise Refused('%s: by must be a GitHub-style name' % where)
    if not _text(man['description'], DESCRIPTION_MAX):
        raise Refused('%s: description must be 1 to %d characters on one line' % (where, DESCRIPTION_MAX))
    if man['category'] != category:
        raise Refused('%s: category must be %s, its folder' % (where, category))
    if 'uses' not in man:
        raise Refused('%s: GIF apps come to the store later; give uses' % where)
    if man['uses'] not in USES:
        raise Refused('%s: uses must be one of %s' % (where, ', '.join(USES)))
    if 'minFirmware' in man and (not isinstance(man['minFirmware'], str) or not SEMVER.fullmatch(man['minFirmware'])):
        raise Refused('%s: minFirmware must be X.Y.Z' % where)
    boards = man.get('boards', list(BOARDS))
    if not isinstance(boards, list) or not boards or len(set(map(str, boards))) != len(boards) or any((b not in BOARDS for b in boards)):
        raise Refused('%s: boards must be a list of s3 and p4, each once' % where)
    check_sheet(man, where)
    return man

def _label(value, most=LABEL_MAX):
    return _text(value, most) and '://' not in value and (not any((unicodedata.category(ch)[0] == 'C' for ch in value)))

def _words(label):
    found, at = ([], 0)
    while True:
        at = label.find('{', at)
        if at < 0:
            return found
        close = min((i for i in (label.find('{', at + 1), label.find('}', at + 1)) if i >= 0), default=-1)
        if close < 0:
            return found
        if label[close] == '{':
            at = close
            continue
        found.append(label[at + 1:close])
        at = close + 1

def _int(value, low, high):
    return type(value) is int and low <= value <= high

def check_settings(settings, where):
    if not isinstance(settings, list) or len(settings) > SETTINGS_MAX:
        raise Refused('%s: settings must be a list of at most %d' % (where, SETTINGS_MAX))
    seen = set()
    for s in settings:
        if not isinstance(s, dict) or not isinstance(s.get('key'), str) or (not KEY.fullmatch(s['key'])):
            raise Refused("%s: a setting's key must be a-z then a-z, 0-9 and _, 16 at most" % where)
        what = '%s: setting %s' % (where, s['key'])
        kind = s.get('type')
        allowed = {'key', 'type', 'label', 'default'} | ({'max'} if kind == 'text' else set()) | ({'options'} if kind == 'choice' else set())
        if kind not in ('text', 'color', 'toggle', 'choice') or set(s) - allowed or 'default' not in s:
            raise Refused('%s must be text, color, toggle or choice with only its own fields' % what)
        if not _label(s.get('label')):
            raise Refused('%s: label must be 1 to %d characters on one line' % (what, LABEL_MAX))
        if s['key'] in seen:
            raise Refused('%s is there twice' % what)
        seen.add(s['key'])
        default = s['default']
        if kind == 'text' and (not (_int(s.get('max'), 1, 32) and isinstance(default, str) and (1 <= len(default) <= s['max']))):
            raise Refused('%s: max must be 1 to 32 and the default 1 to max characters' % what)
        if kind == 'color' and (not (isinstance(default, str) and COLOR.fullmatch(default))):
            raise Refused('%s: default must be a color as #RRGGBB' % what)
        if kind == 'toggle' and (not isinstance(default, bool)):
            raise Refused('%s: default must be true or false' % what)
        if kind == 'choice':
            options = s.get('options')
            if not isinstance(options, list) or not 2 <= len(options) <= 8 or len(set(map(str, options))) != len(options) or (not all((isinstance(o, str) and 1 <= len(o) <= 16 for o in options))) or (default not in options):
                raise Refused('%s: options must be 2 to 8 words of 1 to 16 characters and hold the default' % what)

def check_controls(controls, settings, where):
    if not isinstance(controls, list) or len(controls) > CONTROLS_MAX:
        raise Refused('%s: controls must be a list of at most %d' % (where, CONTROLS_MAX))
    texts = {s['key'] for s in settings if s['type'] == 'text'}
    seen = {}
    fields = {'button': {'arg'}, 'stepper': {'min', 'max'}, 'readout': set(), 'list': {'max', 'chars', 'add'}}
    for c in controls:
        if not isinstance(c, dict) or not isinstance(c.get('key'), str) or (not KEY.fullmatch(c['key'])):
            raise Refused("%s: a control's key must be a-z then a-z, 0-9 and _, 16 at most" % where)
        what = '%s: control %s' % (where, c['key'])
        kind = c.get('type')
        if kind not in fields or set(c) - ({'key', 'type', 'label'} | fields[kind]):
            raise Refused('%s must be a button, stepper, readout or list with only its own fields' % what)
        if ('label' in c or kind != 'readout') and (not _label(c.get('label'))):
            raise Refused('%s: label must be 1 to %d characters on one line' % (what, LABEL_MAX))
        if any((word not in texts for word in _words(c.get('label', '')))):
            raise Refused('%s: a {word} in its label must be a text setting' % what)
        if kind == 'button' and 'arg' in c and (not _int(c['arg'], 0, 86400)):
            raise Refused('%s: arg must be 0 to 86400' % what)
        if kind == 'stepper' and (not (_int(c.get('min'), -99999, 99999) and _int(c.get('max'), -99999, 99999) and (c['min'] < c['max']))):
            raise Refused('%s: min and max must be whole numbers with min under max' % what)
        if kind == 'list' and (not (_int(c.get('max'), 1, 8) and _int(c.get('chars'), 1, 16) and _label(c.get('add')))):
            raise Refused("%s: max must be 1 to 8, chars 1 to 16 and add its button's words" % what)
        if c['key'] in seen:
            other = seen[c['key']]
            if not (kind == 'button' and all((x['type'] == 'button' and 'arg' in x for x in other)) and ('arg' in c) and all((x['arg'] != c['arg'] for x in other))):
                raise Refused('%s is there twice (a button may come again with another arg)' % what)
        seen.setdefault(c['key'], []).append(c)

def check_sheet(man, where):
    settings, controls = (man.get('settings', []), man.get('controls', []))
    if man['uses'] not in CATALOG_USES:
        if 'settings' in man or 'controls' in man:
            raise Refused('%s: a %s app takes no settings or controls' % (where, man['uses']))
        return
    need = '.'.join(map(str, CATALOG_FIRMWARE))
    if tuple((int(n) for n in man.get('minFirmware', '0.0.0').split('.'))) < CATALOG_FIRMWARE:
        raise Refused('%s: a %s app needs minFirmware %s or later' % (where, man['uses'], need))
    check_settings(settings, where)
    check_controls(controls, settings, where)
    table = RENDERER_KEYS[man['uses']]
    for s in settings:
        want = table['settings'].get(s['key'])
        if want is None or want[0] != s['type']:
            raise Refused('%s: %s takes no %s setting %s' % (where, man['uses'], s['type'], s['key']))
        if s['type'] == 'choice' and len(s['options']) != want[1]:
            raise Refused('%s: setting %s needs %d options' % (where, s['key'], want[1]))
        if s['type'] == 'text' and s['max'] > want[1]:
            raise Refused('%s: setting %s is %d characters at most' % (where, s['key'], want[1]))
    for c in controls:
        want = table['controls'].get(c['key'])
        if want is None or want[0] != c['type']:
            raise Refused('%s: %s takes no %s control %s' % (where, man['uses'], c['type'], c['key']))
        if c['type'] == 'list' and c['max'] > want[1]:
            raise Refused('%s: list %s is %d items at most' % (where, c['key'], want[1]))

def check_icon(body, where):
    from . import package
    try:
        package.check_icon(body)
    except package.Refused as error:
        raise Refused(where + ": " + error.line)


def check_prayer(data, where):
    if 'pack.json' not in data:
        raise Refused('%s/data/pack.json is missing' % where)
    try:
        files = json.loads(data['pack.json'].decode('utf-8'))['files']
        assert isinstance(files, dict)
    except (ValueError, KeyError, TypeError, AssertionError):
        raise Refused('%s/data/pack.json has no files list' % where)
    for path in sorted(data):
        if path != 'pack.json' and path not in files:
            raise Refused('%s/data/%s is not in pack.json' % (where, path))
    for path, sha in sorted(files.items()):
        if path not in data:
            raise Refused('%s/data/%s is missing' % (where, path))
        if hashlib.sha256(data[path]).hexdigest() != sha:
            raise Refused('%s/data/%s does not match pack.json' % (where, path))

def check_no_data(uses):

    def check(data, where):
        if data:
            raise Refused('%s: a %s app carries no data/ (its settings live on the board)' % (where, uses))
    return check

def check_list(data, where):
    if sorted(data) != ['list.json']:
        raise Refused('%s: its data/ is list.json alone' % where)
    if len(data['list.json']) > LIST_CAP:
        raise Refused('%s/data/list.json is over 64 KB' % where)
    try:
        body = json.loads(data['list.json'].decode('utf-8'))
    except ValueError:
        raise Refused('%s/data/list.json is not valid JSON' % where)
    if not isinstance(body, dict) or body.get('format') != 1:
        raise Refused('%s/data/list.json must be format 1' % where)
    items = body.get('items')
    if not isinstance(items, list) or not items or (not all((isinstance(i, list) and i and all((isinstance(t, str) for t in i)) for i in items))):
        raise Refused('%s/data/list.json needs items, each a list of strings' % where)

def _list_items(data, where):
    if sorted(data) != ['list.json']:
        raise Refused('%s: its data/ is list.json alone' % where)
    if len(data['list.json']) > LIST_CAP:
        raise Refused('%s/data/list.json is over 64 KB' % where)
    try:
        body = json.loads(data['list.json'].decode('utf-8'))
    except ValueError:
        raise Refused('%s/data/list.json is not valid JSON' % where)
    if not isinstance(body, dict) or body.get('format') != 1:
        raise Refused('%s/data/list.json must be format 1' % where)
    items = body.get('items')
    if not isinstance(items, list) or not items or (not all((isinstance(i, list) for i in items))):
        raise Refused('%s/data/list.json needs items, each a list' % where)
    return items

def _drawn(text, what, where):
    if '—' in text:
        raise Refused('%s: %s has an em dash' % (where, what))
    if any((unicodedata.category(ch).startswith('C') for ch in text)):
        raise Refused('%s: %s has a character the board cannot draw' % (where, what))

def _sized(item, at, name, most, where):
    value = item[at]
    if not isinstance(value, str) or not 1 <= len(value) <= most or value != value.strip():
        raise Refused('%s: %s is 1 to %d characters' % (where, name, most))
    _drawn(value, name, where)
    return value
WORD_KINDS = ('noun', 'verb', 'adjective', 'adverb')

def check_words(data, where):
    check_list(data, where)
    seen = set()
    for n, item in enumerate(_list_items(data, where)):
        at = '%s/data/list.json item %d' % (where, n + 1)
        if len(item) != 3:
            raise Refused('%s is word, kind, and meaning' % at)
        word = _sized(item, 0, 'word', 12, at)
        if item[1] not in WORD_KINDS:
            raise Refused('%s: kind is noun, verb, adjective, or adverb' % at)
        _sized(item, 2, 'meaning', 44, at)
        if word.lower() in seen:
            raise Refused('%s: %s is in the list twice' % (at, word.lower()))
        seen.add(word.lower())
QUOTES_LAST_YEAR = 1930

def check_quotes(data, where):
    seen = set()
    for n, item in enumerate(_list_items(data, where)):
        at = '%s/data/list.json item %d' % (where, n + 1)
        if len(item) != 4:
            raise Refused('%s is text, who, work, and year' % at)
        text = _sized(item, 0, 'text', 72, at)
        _sized(item, 1, 'who', 24, at)
        _sized(item, 2, 'work', 64, at)
        year = item[3]
        if type(year) is not int:
            raise Refused('%s: year is a whole number' % at)
        if year > QUOTES_LAST_YEAR:
            raise Refused('%s: published after %d is not in the public domain' % (at, QUOTES_LAST_YEAR))
        if text in seen:
            raise Refused('%s: %s is in the list twice' % (at, text))
        seen.add(text)
FACT_MAX = 96
JOKE_MAX = 60

def check_facts(data, where):
    check_list(data, where)
    seen = set()
    for n, item in enumerate(_list_items(data, where), 1):
        what = '%s/data/list.json item %d' % (where, n)
        if len(item) != 2:
            raise Refused('%s must be [fact, source]' % what)
        fact, source = item
        if not _text(fact, FACT_MAX):
            raise Refused('%s: the fact must be 1 to %d characters on one line' % (what, FACT_MAX))
        if not source.strip():
            raise Refused('%s needs its source' % what)
        if fact in seen:
            raise Refused('%s repeats a fact' % what)
        seen.add(fact)

def check_jokes(data, where):
    check_list(data, where)
    seen = set()
    for n, item in enumerate(_list_items(data, where), 1):
        what = '%s/data/list.json item %d' % (where, n)
        if len(item) != 2:
            raise Refused('%s must be [setup, punchline]' % what)
        for part, text in zip(('setup', 'punchline'), item):
            if not _text(text, JOKE_MAX):
                raise Refused('%s: the %s must be 1 to %d characters on one line' % (what, part, JOKE_MAX))
        if tuple(item) in seen:
            raise Refused('%s repeats a joke' % what)
        seen.add(tuple(item))
LIST_KEEP = {'quotes': 2, 'facts': 1}

def package_data(uses, data):
    keep = LIST_KEEP.get(uses)
    if keep is None:
        return data
    items = json.loads(data['list.json'].decode('utf-8'))['items']
    rows = ',\n'.join((json.dumps(item[:keep], ensure_ascii=False) for item in items))
    return dict(data, **{'list.json': ('{"format": 1, "items": [\n%s\n]}\n' % rows).encode()})
LIST_CAP = 64 * 1024
USES_CHECKS = {'prayer': check_prayer, 'countdown': check_no_data('countdown'), 'sketch': check_no_data('sketch')}
USES_CHECKS.update({uses: check_no_data(uses) for uses in ('life', 'plasma', 'starfield', 'fireplace')})
USES_CHECKS.update({uses: check_no_data(uses) for uses in CATALOG_USES})
USES_CHECKS.update({uses: check_list for uses in ('word', 'quotes', 'facts', 'jokes')})
USES_CHECKS.update({'word': check_words, 'quotes': check_quotes})
USES_CHECKS.update({'facts': check_facts, 'jokes': check_jokes})

def check_size(app_id, size, boards):
    for board in boards:
        if size > BOARD_CAP[board]:
            raise Refused("%s is %d bytes, over the %s's %d MB" % (app_id, size, board, BOARD_CAP[board] >> 20))

def _read(path):
    with open(path, 'rb') as f:
        return f.read()

def _visible(names):
    return sorted((n for n in names if not n.startswith('.')))

def read_data(folder, where):
    data = {}
    for top, dirs, names in os.walk(folder):
        dirs[:] = _visible(dirs)
        for name in _visible(names):
            path = os.path.relpath(os.path.join(top, name), folder).replace(os.sep, '/')
            if not DATA_PATH.fullmatch(path):
                raise Refused('%s/data/%s is not an allowed name (a-z, A-Z, 0-9, _ and -, .json or .bin, %d folders deep at most)' % (where, path, MAX_DEPTH - 1))
            body = _read(os.path.join(top, name))
            if len(body) > ENTRY_CAP:
                raise Refused('%s/data/%s is over %d KB' % (where, path, ENTRY_CAP >> 10))
            data[path] = body
    return data

def manifest_bytes(man):
    man = dict(man, boards=man.get('boards', list(BOARDS)))
    if 'settings' in man:
        man['settings'] = [{k: s[k] for k in SETTING_KEYS if k in s} for s in man['settings']]
    if 'controls' in man:
        man['controls'] = [{k: c[k] for k in CONTROL_KEYS if k in c} for c in man['controls']]
    return (json.dumps({key: man[key] for key in KEYS if key in man}, ensure_ascii=False, indent=2) + '\n').encode()

def write_zip(entries):
    local, central = (bytearray(), bytearray())
    for name, data in entries:
        raw = name.encode('ascii')
        crc = zlib.crc32(data) & 4294967295
        header = struct.pack('<HHHHHIII', NEEDED, 0, 0, 0, ZIP_DATE, crc, len(data), len(data))
        offset = len(local)
        local += struct.pack('<I', LOCAL) + header + struct.pack('<HH', len(raw), 0) + raw + data
        central += struct.pack('<IH', CENTRAL, MADE_BY) + header
        central += struct.pack('<HHHHHII', len(raw), 0, 0, 0, 0, REGULAR << 16, offset) + raw
    end = struct.pack('<IHHHHIIH', END, 0, 0, len(entries), len(entries), len(central), len(local), 0)
    return bytes(local + central + end)

def load_app(root, category, folder, app_dir=None):
    where = '%s/%s' % (category, folder)
    base = app_dir or os.path.join(root, category, folder)
    for name in _visible(os.listdir(base)):
        if name not in REPO_ONLY + ("build", 'mooboard.json', 'icon.png', 'data'):
            raise Refused('%s/%s is not part of an app (mooboard.json, icon.png, data/, README.md, LICENSE)' % (where, name))
    for name in ('mooboard.json', 'icon.png'):
        if not os.path.isfile(os.path.join(base, name)):
            raise Refused('%s/%s is missing' % (where, name))
    man = check_manifest(_read(os.path.join(base, 'mooboard.json')), category, folder)
    icon = _read(os.path.join(base, 'icon.png'))
    check_icon(icon, where + '/icon.png')
    data = read_data(os.path.join(base, 'data'), where) if os.path.isdir(os.path.join(base, 'data')) else {}
    if 2 + len(data) > MAX_ENTRIES:
        raise Refused('%s has more than %d entries' % (where, MAX_ENTRIES))
    USES_CHECKS[man['uses']](data, where)
    data = package_data(man['uses'], data)
    entries = [('mooboard.json', manifest_bytes(man)), ('icon.png', icon)]
    entries += [('data/' + path, data[path]) for path in sorted(data)]
    package = write_zip(entries)
    boards = man.get('boards', list(BOARDS))
    check_size(man['id'], len(package), boards)
    return (man, icon, package, boards, len(entries))
