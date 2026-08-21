# acceso Specification

## Purpose
Controla quién puede ver el inventario y mantiene la sesión abierta entre visitas, de forma que un tag NFC o un QR escaneado por alguien de fuera no revele nada del contenido.

## Requirements

### Requirement: Entrada con usuario y contraseña
El sistema SHALL permitir entrar con un identificador —nombre de usuario o correo, sin distinguir mayúsculas— junto a una contraseña, y SHALL rechazar la entrada si cualquiera de los dos no coincide.

Ante credenciales inválidas el sistema MUST responder siempre el mismo mensaje, exista o no ese usuario, y MUST hacer el mismo trabajo de verificación en ambos casos, para que el tiempo de respuesta no delate qué usuarios están dados de alta.

#### Scenario: Credenciales correctas
- **WHEN** alguien envía un identificador y una contraseña que coinciden con los de un usuario registrado
- **THEN** el sistema abre una sesión y devuelve el nombre, el usuario y el correo de esa persona

#### Scenario: Contraseña incorrecta
- **WHEN** alguien envía un identificador existente con una contraseña que no coincide
- **THEN** el sistema responde 401 sin abrir sesión, con un mensaje que no distingue entre usuario y contraseña

#### Scenario: Usuario inexistente
- **WHEN** alguien envía un identificador que no corresponde a ningún usuario
- **THEN** el sistema responde 401 con el mismo mensaje y tras verificar la contraseña contra un hash de descarte, de modo que tarde lo mismo que el caso anterior

#### Scenario: Falta el usuario o la contraseña
- **WHEN** alguien envía la petición con el identificador o la contraseña vacíos
- **THEN** el sistema responde 400 pidiendo ambos datos, y ese intento no cuenta como fallido

### Requirement: Sesión persistente en cookie
Al entrar, el sistema SHALL abrir una sesión cuya duración se configura en días y SHALL entregarla en una cookie inaccesible a JavaScript, que no viaja en peticiones cruzadas de terceros y queda acotada a todo el sitio, marcada para viajar solo cifrada cuando la instalación está publicada por HTTPS.

El sistema MUST guardar en la base únicamente el hash del token de sesión, nunca el token en claro, para que quien obtenga una copia de la base no pueda reutilizar sesiones abiertas.

#### Scenario: La sesión sobrevive al cierre del navegador
- **WHEN** alguien entró correctamente y vuelve al sitio antes de que expire su sesión
- **THEN** el sistema lo reconoce por la cookie y no le vuelve a pedir la contraseña

#### Scenario: Sesión expirada
- **WHEN** alguien vuelve con una cookie cuya sesión ya pasó su fecha de expiración
- **THEN** el sistema la trata como si no existiera y exige entrar de nuevo

#### Scenario: Copia de la base en manos ajenas
- **WHEN** alguien obtiene una copia de la tabla de sesiones
- **THEN** los valores almacenados no sirven como cookie, porque son hashes y no los tokens originales

### Requirement: Cierre de sesión
El sistema SHALL ofrecer una forma de cerrar la sesión en curso que borre su registro en la base y limpie la cookie del navegador.

#### Scenario: Cierre voluntario
- **WHEN** una persona con sesión abierta pide cerrarla
- **THEN** el sistema elimina esa sesión de la base y limpia la cookie, y la siguiente petición vuelve a exigir contraseña

### Requirement: Todo exige sesión salvo la entrada y los recursos estáticos
El sistema SHALL exigir sesión válida en toda ruta que no sea la pantalla de entrada ni los recursos estáticos de presentación del propio sitio.

Sin sesión, el sistema SHALL responder 401 en JSON a las peticiones de API y SHALL redirigir a la pantalla de entrada a las peticiones de página.

#### Scenario: Petición de API sin sesión
- **WHEN** alguien pide un recurso de la API sin cookie válida
- **THEN** el sistema responde 401 con un cuerpo JSON que indica que hace falta sesión y dónde entrar

#### Scenario: Petición de página sin sesión
- **WHEN** alguien abre una página del sitio sin cookie válida
- **THEN** el sistema lo redirige a la pantalla de entrada

#### Scenario: Recursos estáticos
- **WHEN** el navegador pide la hoja de estilos o el script del sitio
- **THEN** el sistema los sirve sin exigir sesión, porque no contienen datos del inventario

### Requirement: Regreso al tag escaneado tras entrar
Cuando alguien llega sin sesión a la ficha de un producto, el sistema SHALL recordar ese destino y SHALL llevarlo allí automáticamente después de entrar, en lugar de dejarlo en el listado general.

El sistema MUST aceptar como destino únicamente rutas internas del propio sitio, y MUST caer al inicio ante cualquier otro valor, para que un enlace manipulado no pueda usar la pantalla de entrada como trampolín hacia un sitio ajeno.

#### Scenario: Tag escaneado sin sesión
- **WHEN** alguien escanea el tag de un producto, no tiene sesión y entra con sus credenciales
- **THEN** el sistema lo lleva a la ficha de ese producto, no al listado

#### Scenario: Destino manipulado hacia otro sitio
- **WHEN** el destino recordado apunta a un dominio externo o a una ruta que no empieza por una sola barra
- **THEN** el sistema lo descarta y lleva a la persona al inicio

#### Scenario: Ya hay sesión abierta
- **WHEN** alguien con sesión válida abre la pantalla de entrada llevando un destino
- **THEN** el sistema no le pide credenciales y lo manda directo a ese destino

### Requirement: Freno a los intentos de adivinar contraseñas
El sistema SHALL contar los intentos fallidos dentro de una ventana de tiempo y SHALL responder 429 al superarse cualquiera de dos umbrales: uno por combinación de origen e identificador, y otro más alto por origen, este último para frenar el barrido de muchos usuarios distintos desde un mismo sitio.

El sistema MUST aplicar el freno antes de comprobar la contraseña, y MUST descartar los conteos ya vencidos para que la memoria no crezca sin límite.

#### Scenario: Se insiste contra un mismo usuario
- **WHEN** desde un mismo origen se acumulan intentos fallidos contra el mismo identificador hasta pasar el umbral, dentro de la ventana
- **THEN** el sistema responde 429 pidiendo esperar, sin llegar a comprobar la contraseña

#### Scenario: Se barren muchos usuarios desde un mismo origen
- **WHEN** desde un mismo origen se acumulan intentos fallidos contra identificadores distintos hasta pasar el umbral por origen
- **THEN** el sistema responde 429 a cualquier intento posterior desde ese origen mientras dure la ventana

#### Scenario: La ventana vence
- **WHEN** pasa la ventana de tiempo sin nuevos intentos fallidos
- **THEN** el conteo se descarta y esa combinación vuelve a poder intentar

#### Scenario: Entrada correcta antes del umbral
- **WHEN** alguien falla algunas veces y luego acierta, sin haber llegado al umbral
- **THEN** el sistema abre la sesión y olvida los fallos acumulados contra ese identificador

### Requirement: Autorización por rol
Cada usuario SHALL tener un rol que determine si puede modificar el inventario. El rol `admin` lee y escribe; el rol `lector` solo lee.

Ante cualquier escritura pedida por un usuario sin permiso, el sistema MUST responder 403 y MUST dejar los datos intactos.

#### Scenario: Lector intenta escribir
- **WHEN** un usuario con rol `lector` pide crear, editar o borrar un producto o su foto
- **THEN** el sistema responde 403 y no altera nada

#### Scenario: Lector consulta
- **WHEN** un usuario con rol `lector` consulta el listado o la ficha de un producto
- **THEN** el sistema responde con normalidad, igual que a un `admin`

#### Scenario: La interfaz refleja el rol
- **WHEN** un usuario con rol `lector` abre una ficha
- **THEN** la interfaz no le ofrece los controles de edición

### Requirement: Cabeceras de seguridad en toda respuesta
El sistema SHALL enviar en cada respuesta una política de seguridad de contenido que impida enmarcar el sitio, cargar objetos y abrir conexiones fuera del propio origen; SHALL impedir que el navegador adivine el tipo de los contenidos; y SHALL limitar la información de procedencia que se filtra al navegar hacia terceros.

Cuando la instalación está publicada por HTTPS, el sistema SHALL además exigir al navegador que solo la visite cifrada.

#### Scenario: Cualquier respuesta
- **WHEN** el sistema responde a cualquier petición
- **THEN** la respuesta incluye la política de contenido, la prohibición de adivinar tipos, la prohibición de enmarcado y la política de procedencia

#### Scenario: Intento de enmarcar el inventario
- **WHEN** una página ajena intenta cargar el inventario dentro de un marco
- **THEN** el navegador lo bloquea

#### Scenario: Instalación publicada por HTTPS
- **WHEN** la instalación está configurada para servir por HTTPS
- **THEN** las respuestas incluyen además la cabecera que obliga al navegador a usar siempre TLS
