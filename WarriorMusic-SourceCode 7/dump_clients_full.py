import zipfile, struct

with zipfile.ZipFile(r'C:\Users\Hp\.gemini\antigravity\scratch\novax-music-app\original_novax.apk') as z:
    dex = z.read('classes.dex')

string_ids_size, string_ids_off = struct.unpack('<II', dex[0x38:0x40])
str_offsets = [struct.unpack('<I', dex[string_ids_off+i*4:string_ids_off+i*4+4])[0] for i in range(string_ids_size)]
strings = []
for off in str_offsets:
    p = off
    val, shift = 0, 0
    while True:
        b = dex[p]; p += 1
        val |= (b & 0x7f) << shift
        if not (b & 0x80): break
        shift += 7
    end = dex.find(b'\x00', p)
    strings.append(dex[p:end].decode('latin1'))

type_ids_size, type_ids_off = struct.unpack('<II', dex[0x40:0x48])
types = [strings[struct.unpack('<I', dex[type_ids_off+i*4:type_ids_off+i*4+4])[0]] for i in range(type_ids_size)]
method_ids_size, method_ids_off = struct.unpack('<II', dex[0x58:0x60])
methods = [f'{types[struct.unpack("<H", dex[method_ids_off+i*8:method_ids_off+i*8+2])[0]]}->{strings[struct.unpack("<I", dex[method_ids_off+i*8+4:method_ids_off+i*8+8])[0]]}' for i in range(method_ids_size)]

def dump_cls(target_cname):
    class_defs_size, class_defs_off = struct.unpack('<II', dex[0x60:0x68])
    for i in range(class_defs_size):
        c_off = class_defs_off + i * 32
        class_idx, access_flags, superclass_idx, interfaces_off, source_file_idx, annotations_off, class_data_off, static_values_off = struct.unpack('<IIIIIIII', dex[c_off:c_off+32])
        cname = types[class_idx]
        if target_cname in cname:
            print(f'=== Class: {cname} ===')
            p = class_data_off
            def read_uleb(buf, cur):
                val, shift = 0, 0
                while True:
                    b = buf[cur]; cur += 1
                    val |= (b & 0x7f) << shift
                    if not (b & 0x80): break
                    shift += 7
                return val, cur
            sf, p = read_uleb(dex, p); ifld, p = read_uleb(dex, p); dm, p = read_uleb(dex, p); vm, p = read_uleb(dex, p)
            for _ in range(sf + ifld): _, p = read_uleb(dex, p); _, p = read_uleb(dex, p)
            m_idx = 0
            for _ in range(dm + vm):
                diff, p = read_uleb(dex, p); m_idx += diff
                m_flags, p = read_uleb(dex, p); code_off, p = read_uleb(dex, p)
                mname = methods[m_idx]
                print(f'\nMethod: {mname} (code_off={hex(code_off)})')
                if code_off:
                    reg_size, ins_size, outs_size, tries_size, debug_off, insns_size = struct.unpack('<HHHHII', dex[code_off:code_off+16])
                    insns = dex[code_off+16:code_off+16+insns_size*2]
                    ip = 0
                    while ip < len(insns):
                        op = insns[ip]
                        if op == 0x1a:
                            s_idx = struct.unpack('<H', insns[ip+2:ip+4])[0]
                            print(f'  [{ip}] const-string: "{strings[s_idx]}"')
                            ip += 4
                        elif op in (0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78):
                            meth_idx = struct.unpack('<H', insns[ip+2:ip+4])[0]
                            print(f'  [{ip}] invoke: {methods[meth_idx]}')
                            ip += 6
                        else:
                            ip += 2

dump_cls('MainActivity$3')
dump_cls('MainActivity$2')
