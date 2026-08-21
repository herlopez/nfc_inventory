# fotos-de-producto Specification

## Purpose
Permite ponerle cara a cada producto con una foto tomada desde el móvil, guardada dentro de la propia base para que el respaldo del sistema sea uno solo y la foto no se vea sin sesión.

## Requirements

### Requirement: Una foto propia por producto
El sistema SHALL admitir como mucho una foto subida por producto. Subir una nueva SHALL reemplazar la anterior en lugar de acumularla.

La foto SHALL guardarse dentro de la misma base que el resto del inventario, de modo que un único respaldo de la base incluya también las imágenes y no haga falta conservar aparte un directorio de archivos.

#### Scenario: Primera foto
- **WHEN** un usuario autorizado sube una foto a un producto que no tenía ninguna
- **THEN** el sistema la guarda y la asocia a ese producto

#### Scenario: Reemplazo de la foto
- **WHEN** un usuario autorizado sube una foto a un producto que ya tenía una
- **THEN** el sistema sustituye la anterior, y el producto sigue teniendo exactamente una

#### Scenario: Respaldo de la base
- **WHEN** se toma un respaldo de la base
- **THEN** ese respaldo contiene también las fotos, sin necesidad de copiar archivos aparte

### Requirement: La foto solo se ve con sesión
El sistema SHALL exigir sesión válida para servir la foto de un producto, igual que para el resto del inventario.

El sistema MUST marcar la respuesta como cacheable solo por el navegador de quien la pidió, nunca por un intermediario compartido, para que la foto no quede almacenada en un proxy accesible sin sesión.

#### Scenario: Petición sin sesión
- **WHEN** alguien pide la foto de un producto sin sesión válida
- **THEN** el sistema no la entrega

#### Scenario: Cacheo por intermediarios
- **WHEN** el sistema entrega una foto
- **THEN** la respuesta indica que solo puede guardarla el navegador que la pidió, no una caché compartida

### Requirement: Solo se aceptan imágenes de verdad
El sistema SHALL admitir únicamente los formatos de imagen habituales en fotografía web, y MUST comprobar los primeros bytes del archivo además del tipo declarado, porque el tipo declarado lo elige quien sube y se puede mentir.

El sistema SHALL rechazar lo que supere el tamaño máximo admitido.

#### Scenario: Formato no admitido
- **WHEN** se sube un archivo declarando un tipo que no está entre los formatos admitidos
- **THEN** el sistema responde 415 indicando qué formatos acepta, y no guarda nada

#### Scenario: Archivo disfrazado de imagen
- **WHEN** se sube un archivo que declara un tipo admitido pero cuyos primeros bytes no corresponden a ese formato
- **THEN** el sistema responde 400 indicando que no es una imagen válida, y no guarda nada

#### Scenario: Cuerpo vacío
- **WHEN** se envía la petición de subida sin contenido
- **THEN** el sistema responde 400 pidiendo la imagen en el cuerpo

#### Scenario: Imagen demasiado grande
- **WHEN** se sube una imagen que supera el tamaño máximo admitido
- **THEN** el sistema la rechaza indicando que el contenido es demasiado grande

#### Scenario: Producto inexistente
- **WHEN** se sube una foto a un identificador de producto que no existe
- **THEN** el sistema responde 404 y no guarda nada

### Requirement: La foto se reduce antes de salir del teléfono
Al elegir o tomar una foto desde la interfaz, el sistema SHALL reducirla y recomprimirla en el propio navegador antes de subirla, respetando la orientación con la que se tomó, de modo que una foto de varios megapíxeles viaje como un archivo de unos pocos cientos de kilobytes.

#### Scenario: Foto tomada desde el móvil
- **WHEN** alguien toma una foto con la cámara del teléfono desde la interfaz de edición
- **THEN** el navegador la reduce y recomprime antes de subirla, y lo que viaja es la versión reducida

#### Scenario: Foto tomada de lado
- **WHEN** la foto original trae información de orientación porque se tomó girando el teléfono
- **THEN** la versión reducida se guarda ya con la orientación correcta, sin aparecer girada

### Requirement: La foto subida manda sobre la imagen enlazada
Un producto SHALL poder tener a la vez una foto subida y una dirección web de imagen externa. Cuando existan ambas, la interfaz MUST mostrar la foto subida.

#### Scenario: Solo imagen enlazada
- **WHEN** un producto tiene una dirección web de imagen y ninguna foto subida
- **THEN** la ficha muestra la imagen enlazada

#### Scenario: Ambas presentes
- **WHEN** un producto tiene una foto subida y además una dirección web de imagen
- **THEN** la ficha muestra la foto subida

### Requirement: La foto se revalida sola cuando cambia
El sistema SHALL identificar cada foto con una marca derivada de su contenido y SHALL usarla para que el navegador reutilice la copia que ya tiene mientras la foto no cambie, y descargue la nueva en cuanto cambie.

#### Scenario: Foto sin cambios
- **WHEN** el navegador vuelve a pedir una foto que ya tiene, indicando la marca que guardó
- **THEN** el sistema responde que no ha cambiado, sin reenviar la imagen

#### Scenario: Foto reemplazada
- **WHEN** se sustituye la foto de un producto por otra distinta
- **THEN** la marca cambia y el navegador descarga la nueva en lugar de mostrar la anterior desde su caché

### Requirement: Retirar la foto
El sistema SHALL permitir a un usuario autorizado quitar la foto de un producto sin borrar el producto.

Al dar de baja un producto, el sistema MUST eliminar también su foto, para que no queden imágenes huérfanas ocupando la base.

#### Scenario: Retirada explícita
- **WHEN** un usuario autorizado quita la foto de un producto que la tenía
- **THEN** el sistema la elimina y el producto queda sin foto subida

#### Scenario: Retirada de una foto inexistente
- **WHEN** se pide quitar la foto de un producto que no tenía ninguna
- **THEN** el sistema responde 404 indicando que ese producto no tiene foto

#### Scenario: Baja del producto
- **WHEN** se da de baja un producto que tenía foto
- **THEN** el sistema elimina también la foto
