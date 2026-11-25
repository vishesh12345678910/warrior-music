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
field_ids_size, field_ids_off = struct.unpack('<II', dex[0x50:0x58])
fields = [f'{types[struct.unpack("<H", dex[field_ids_off+i*8:field_ids_off+i*8+2])[0]]}->{strings[struct.unpack("<I", dex[field_ids_off+i*8+4:field_ids_off+i*8+8])[0]]}' for i in range(field_ids_size)]

code_off = 0x2454
reg_size, ins_size, outs_size, tries_size, debug_off, insns_size = struct.unpack('<HHHHII', dex[code_off:code_off+16])
insns = dex[code_off+16:code_off+16+insns_size*2]
ip = 0
while ip < len(insns):
    op = insns[ip]
    line = f'[{ip:03d}] op=0x{op:02x}'
    if op == 0x1a:
        s_idx = struct.unpack('<H', insns[ip+2:ip+4])[0]
        line += f' const-string: "{strings[s_idx]}"'
        ip += 4
    elif op in (0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78):
        meth_idx = struct.unpack('<H', insns[ip+2:ip+4])[0]
        line += f' invoke: {methods[meth_idx]}'
        ip += 6
    elif op in (0x54, 0x5b):
        f_idx = struct.unpack('<H', insns[ip+2:ip+4])[0]
        line += f' iget: {fields[f_idx]}'
        ip += 4
    elif op == 0x0e:
        line += ' return-void'
        ip += 2
    elif op == 0x0f:
        line += ' return'
        ip += 2
    elif op == 0x12:
        line += f' const/4 v{insns[ip+1]>>4}, {insns[ip+1]&0xf}'
        ip += 2
    else:
        line += f' bytes: {insns[ip:ip+2].hex()}'
        ip += 2
    print(line)
